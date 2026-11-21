// VELOCE Garage API: accounts, the global leaderboard, "My garage" and the admin panel,
// stored in Microsoft SQL Server through Entity Framework Core.
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using Veloce.Api.Data;
using Veloce.Api.Models;
using Veloce.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;
// containers (Vercel, Docker) say which port to listen on through PORT
if (Environment.GetEnvironmentVariable("PORT") is { Length: > 0 } port)
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
var bootLog = LoggerFactory.Create(l => l.AddConsole());
var log = bootLog.CreateLogger("Startup");

// ---- database ----
// "ConnectionStrings:Veloce" comes from User Secrets (Visual Studio: right-click the project →
// Manage User Secrets) or from the host's environment variable ConnectionStrings__Veloce.
var connection = config.GetConnectionString("Veloce");
if (string.IsNullOrWhiteSpace(connection))
    log.LogWarning("ConnectionStrings:Veloce is not set: the API starts without a database. {Hint}", Veloce.Api.Controllers.DbHints.Missing);
builder.Services.AddDbContext<VeloceDbContext>(o =>
    o.UseSqlServer(string.IsNullOrWhiteSpace(connection) ? "Server=.;Database=Veloce;Connect Timeout=2" : connection,
        sql => sql.EnableRetryOnFailure(3)));

// ---- auth: JWT bearer tokens ----
var key = TokenService.LoadKey(config, builder.Environment, log);
builder.Services.AddSingleton(new TokenService(key));
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;          // keep "sub" as "sub"
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = TokenService.Issuer,
        ValidAudience = TokenService.Issuer,
        IssuerSigningKey = key,
        ClockSkew = TimeSpan.FromMinutes(2),
    };
});
builder.Services.AddAuthorization();

// ---- slow down password guessing: 10 login / register attempts a minute per address ----
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.OnRejected = (ctx, ct) => new ValueTask(ctx.HttpContext.Response.WriteAsJsonAsync(new { error = "ძალიან ბევრი მცდელობა. სცადე ერთ წუთში." }, ct));
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

// ---- the front end may run on another address (e.g. Vercel without the /api rewrite) ----
var origins = config.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    if (origins.Length > 0) p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
}));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.SwaggerDoc("v1", new OpenApiInfo { Title = "VELOCE Garage API", Version = "v1" });
    o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT",
        Description = "ჩასვი /api/auth/login-ის პასუხის token",
    });
    o.AddSecurityRequirement(doc => new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference("Bearer", doc)] = [] });
});

var app = builder.Build();

// behind a proxy (Vercel, IIS, nginx) the client address comes in X-Forwarded-For
var fwd = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto };
fwd.KnownIPNetworks.Clear();
fwd.KnownProxies.Clear();
app.UseForwardedHeaders(fwd);

// unexpected errors: a short JSON message, never database details
app.UseExceptionHandler(e => e.Run(async ctx =>
{
    ctx.Response.StatusCode = 500;
    await ctx.Response.WriteAsJsonAsync(new { error = "სერვერის შეცდომა. სცადე მოგვიანებით." });
}));

// create / update the tables once the app is listening (Migrations folder). It runs in the
// background so the site opens at once even when the database is slow or unreachable;
// /api/health then explains the problem.
if (config.GetValue("Database:MigrateOnStartup", true) && !string.IsNullOrWhiteSpace(connection))
{
    app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(() =>
    {
        try
        {
            using var scope = app.Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<VeloceDbContext>().Database.Migrate();
            log.LogInformation("Database is up to date.");
        }
        catch (Exception ex)
        {
            var msg = Veloce.Api.Controllers.DbHints.Message(ex);
            log.LogError("Database is not reachable: {Message}\n{Hint}", msg, Veloce.Api.Controllers.DbHints.For(msg));
        }
    }));
}

if (app.Environment.IsDevelopment() || config.GetValue("Swagger:Enabled", false))
{
    app.UseSwagger();
    app.UseSwaggerUI(o => o.DocumentTitle = "VELOCE Garage API");
}

// ---- the 3D site itself (Frontend:Path, the repository root in Development): one F5 runs everything ----
var frontPath = config["Frontend:Path"];
if (!string.IsNullOrWhiteSpace(frontPath))
{
    var root = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, frontPath));
    if (File.Exists(Path.Combine(root, "index.html")))
    {
        var files = new PhysicalFileProvider(root);
        var types = new FileExtensionContentTypeProvider();
        types.Mappings[".glb"] = "model/gltf-binary";
        types.Mappings[".gltf"] = "model/gltf+json";
        types.Mappings[".bin"] = "application/octet-stream";
        types.Mappings[".usdz"] = "model/vnd.usdz+zip";
        types.Mappings[".mjs"] = "text/javascript";
        // never serve the backend sources, tools or git data
        app.Use(async (ctx, next) =>
        {
            var p = ctx.Request.Path.Value ?? "";
            if (p.StartsWith("/backend", StringComparison.OrdinalIgnoreCase) || p.StartsWith("/.", StringComparison.Ordinal) ||
                p.StartsWith("/tools", StringComparison.OrdinalIgnoreCase))
            { ctx.Response.StatusCode = 404; return; }
            await next();
        });
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = files, ContentTypeProvider = types });
        log.LogInformation("Serving the site from {Root}", root);
    }
    else log.LogWarning("Frontend:Path {Root} has no index.html: serving the API only.", root);
}

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
// unknown /api addresses answer with JSON, not an empty page
app.Map("/api/{**rest}", (HttpContext ctx) => Results.Json(new { error = "ასეთი მისამართი არ არსებობს." }, statusCode: 404));

app.Run();

// lets an integration test start the app (WebApplicationFactory<Program>)
public partial class Program { }
