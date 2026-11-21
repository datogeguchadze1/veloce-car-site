using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Veloce.Api.Models;

namespace Veloce.Api.Services;

// Issues the JWT that the front end keeps and sends as "Authorization: Bearer ...".
public class TokenService(SymmetricSecurityKey key)
{
    public const string Issuer = "veloce-garage";
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);

    public string Create(User user)
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Name, user.DisplayName),
        };
        var token = new JwtSecurityToken(
            issuer: Issuer, audience: Issuer, claims: claims,
            expires: DateTime.UtcNow.Add(Lifetime),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    // The signing key comes from configuration ("Jwt:Key"). In Development a random key is made
    // when none is set, so the project runs right after cloning (logins then end on restart).
    public static SymmetricSecurityKey LoadKey(IConfiguration config, IHostEnvironment env, ILogger log)
    {
        var secret = config["Jwt:Key"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            if (!env.IsDevelopment())
                throw new InvalidOperationException("Jwt:Key is not set. Add a random string of 32+ characters to the app settings.");
            secret = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48));
            log.LogWarning("Jwt:Key is not set: using a temporary key (logins end when the app restarts).");
        }
        if (secret.Length < 32) throw new InvalidOperationException("Jwt:Key must be at least 32 characters long.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    }
}
