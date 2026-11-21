using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Veloce.Api.Data;

namespace Veloce.Api.Services;

// Lets a request through only when the signed-in user is an admin *now*: the flag is read from
// the database on every call, so taking the role away works at once (not when the token expires).
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class AdminOnlyAttribute : Attribute, IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var id = context.HttpContext.User.UserId();
        if (id is null) { context.Result = new UnauthorizedResult(); return; }
        var db = context.HttpContext.RequestServices.GetRequiredService<VeloceDbContext>();
        var isAdmin = await db.Users.AnyAsync(u => u.Id == id && u.IsAdmin);
        if (!isAdmin) context.Result = new ObjectResult(new { error = "მხოლოდ ადმინისთვის." }) { StatusCode = 403 };
    }
}
