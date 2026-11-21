using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace Veloce.Api.Services;

public static class ClaimsExtensions
{
    // The signed-in user's id (the JWT "sub" claim), or null for anonymous requests.
    public static int? UserId(this ClaimsPrincipal user)
    {
        var sub = user.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(sub, out var id) ? id : null;
    }
}
