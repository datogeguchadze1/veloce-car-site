using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Veloce.Api.Data;
using Veloce.Api.Dtos;
using Veloce.Api.Models;
using Veloce.Api.Services;

namespace Veloce.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(VeloceDbContext db, TokenService tokens, IPasswordHasher<User> hasher, IConfiguration config) : ControllerBase
{
    // POST /api/auth/register  { email, password, displayName }
    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        var name = (req.DisplayName ?? "").Trim();
        if (!GameRules.EmailRegex().IsMatch(email) || email.Length > 254) return BadRequest(new { error = "ელ-ფოსტა არასწორია." });
        if ((req.Password ?? "").Length is < 8 or > 100) return BadRequest(new { error = "პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო." });
        if (name.Length is < 2 or > 40) return BadRequest(new { error = "სახელი უნდა იყოს 2–40 სიმბოლო." });
        if (await db.Users.AnyAsync(u => u.Email == email)) return Conflict(new { error = "ეს ელ-ფოსტა უკვე დარეგისტრირებულია." });

        var user = new User { Email = email, DisplayName = name };
        user.PasswordHash = hasher.HashPassword(user, req.Password!);
        // admins: the e-mails listed in "Admin:Emails"; with none listed, the very first account
        user.IsAdmin = IsAdminEmail(email) || (AdminEmails().Length == 0 && !await db.Users.AnyAsync());
        db.Users.Add(user);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { return Conflict(new { error = "ეს ელ-ფოსტა უკვე დარეგისტრირებულია." }); }
        return new AuthResponse(tokens.Create(user), ToDto(user));
    }

    // POST /api/auth/login  { email, password }
    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        var result = user is null ? PasswordVerificationResult.Failed : hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password ?? "");
        if (user is null || result == PasswordVerificationResult.Failed)
            return Unauthorized(new { error = "ელ-ფოსტა ან პაროლი არასწორია." });

        if (result == PasswordVerificationResult.SuccessRehashNeeded) user.PasswordHash = hasher.HashPassword(user, req.Password!);
        if (!user.IsAdmin && IsAdminEmail(email)) user.IsAdmin = true;
        await db.SaveChangesAsync();
        return new AuthResponse(tokens.Create(user), ToDto(user));
    }

    // GET /api/auth/me — who is signed in (the front end calls it on start)
    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult<UserDto>> Me()
    {
        var user = await db.Users.FindAsync(User.UserId());
        return user is null ? Unauthorized() : ToDto(user);
    }

    private string[] AdminEmails() =>
        (config.GetSection("Admin:Emails").Get<string[]>() ?? []).Select(e => e.Trim().ToLowerInvariant()).Where(e => e.Length > 0).ToArray();
    private bool IsAdminEmail(string email) => AdminEmails().Contains(email);
    private static UserDto ToDto(User u) => new(u.Id, u.Email, u.DisplayName, u.IsAdmin);
}
