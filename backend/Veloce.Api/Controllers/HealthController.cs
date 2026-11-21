using Microsoft.AspNetCore.Mvc;
using Veloce.Api.Data;

namespace Veloce.Api.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController(VeloceDbContext db) : ControllerBase
{
    // GET /api/health → { ok: true, db: true|false }. The front end turns accounts on only when
    // this answers, so the static site (e.g. on GitHub Pages) keeps working without a backend.
    [HttpGet]
    public async Task<object> Get()
    {
        bool dbOk;
        try { dbOk = await db.Database.CanConnectAsync(); } catch { dbOk = false; }
        return new { ok = true, db = dbOk };
    }
}
