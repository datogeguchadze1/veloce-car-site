using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Veloce.Api.Data;

namespace Veloce.Api.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController(VeloceDbContext db, IHostEnvironment env, IConfiguration config) : ControllerBase
{
    // GET /api/health → { ok: true, db: true|false }. The front end turns accounts on only when
    // this answers, so the static site (e.g. on GitHub Pages) keeps working without a backend.
    // In Development a failed database check also returns the reason and a hint in Georgian.
    [HttpGet]
    public async Task<object> Get()
    {
        if (string.IsNullOrWhiteSpace(config.GetConnectionString("Veloce")))
            return Result(false, "ConnectionStrings:Veloce is empty", DbHints.Missing);
        try
        {
            await db.Database.OpenConnectionAsync();
            await db.Database.CloseConnectionAsync();
            return new { ok = true, db = true };
        }
        catch (Exception ex)
        {
            var msg = DbHints.Message(ex);
            return Result(false, msg, DbHints.For(msg));
        }
    }

    private object Result(bool ok, string error, string hint) =>
        env.IsDevelopment() ? new { ok = true, db = ok, error, hint } : new { ok = true, db = ok };
}

// Turns common SQL Server connection errors into advice in Georgian.
public static class DbHints
{
    public const string Missing =
        "connection string არ არის დაყენებული. Visual Studio-ში: Veloce.Api-ზე მარჯვენა ღილაკი → Manage User Secrets → " +
        "\"ConnectionStrings\": { \"Veloce\": \"...\" } (სწორედ ასეთი სახელებით), შემდეგ პროექტის თავიდან გაშვება.";

    // the SQL Server error text plus its root cause (e.g. a certificate problem behind a
    // "pre-login handshake" error), without repeats
    public static string Message(Exception ex)
    {
        var parts = new List<string>();
        for (var e = ex; e is not null; e = e.InnerException)
            if ((e is Microsoft.Data.SqlClient.SqlException || e.InnerException is null) && !parts.Contains(e.Message.Trim()))
                parts.Add(e.Message.Trim());
        return parts.Count > 0 ? string.Join("\n", parts) : ex.Message;
    }

    public static string For(string msg)
    {
        var m = msg.ToLowerInvariant();
        if (m.Contains("certificate") || m.Contains("ssl") || m.Contains("tls"))
            return "SQL Server-ის სერტიფიკატს არ ენდობა: connection string-ის ბოლოს დაამატე TrustServerCertificate=True;";
        if (m.Contains("login failed"))
            return "მომხმარებელი ან პაროლი არასწორია (ან SQL Server-ზე ჩართული არ არის SQL Server authentication). Windows-ის ანგარიშით შესასვლელად: Trusted_Connection=True;";
        if (m.Contains("cannot open database"))
            return "სერვერთან კავშირი არის, მაგრამ ბაზაზე წვდომა არა: შეამოწმე Database=... სახელი და ამ მომხმარებლის უფლებები.";
        if (m.Contains("network-related") || m.Contains("server was not found") || m.Contains("error: 26") || m.Contains("error: 40") || m.Contains("timeout"))
            return "სერვერი ვერ მოიძებნა: შეამოწმე Server=... (მაგ. localhost, .\\SQLEXPRESS ან (localdb)\\MSSQLLocalDB), რომ SQL Server სერვისი ჩართულია და TCP/IP დაშვებულია.";
        if (m.Contains("keyword not supported") || m.Contains("format of the initialization string"))
            return "connection string-ის ფორმატი არასწორია: შეამოწმე ბრჭყალები, წერტილ-მძიმეები და სახელები (Server, Database, User Id, Password).";
        return "ბაზასთან კავშირი ვერ მოხერხდა: იხილე error და შეამოწმე connection string.";
    }
}
