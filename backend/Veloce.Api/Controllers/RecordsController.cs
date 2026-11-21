using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Veloce.Api.Data;
using Veloce.Api.Dtos;
using Veloce.Api.Models;
using Veloce.Api.Services;

namespace Veloce.Api.Controllers;

[ApiController]
[Route("api")]
public class RecordsController(VeloceDbContext db) : ControllerBase
{
    // POST /api/records  { carId, track, lapMs?, drift? }
    // Keeps only the player's best lap / drift for the car and track and answers with their place.
    [Authorize]
    [HttpPost("records")]
    public async Task<ActionResult<SubmitRecordResponse>> Submit(SubmitRecordRequest req)
    {
        if (!GameRules.IsCarId(req.CarId) || !GameRules.Tracks.Contains(req.Track ?? ""))
            return BadRequest(new { error = "უცნობი მანქანა ან ტრასა." });
        if (req.LapMs is { } lap && (lap < GameRules.MinLapMs || lap > GameRules.MaxLapMs))
            return BadRequest(new { error = "წრის დრო არარეალურია." });
        if (req.Drift is { } d && (d <= 0 || d > GameRules.MaxDrift))
            return BadRequest(new { error = "დრიფტის ქულა არარეალურია." });
        if (req.LapMs is null && req.Drift is null) return BadRequest(new { error = "შედეგი არ არის." });

        var userId = User.UserId()!.Value;
        var now = DateTime.UtcNow;
        var rec = await db.Records.FindAsync(userId, req.CarId, req.Track);
        if (rec is null)
        {
            rec = new LapRecord { UserId = userId, CarId = req.CarId, Track = req.Track! };
            db.Records.Add(rec);
        }
        bool lapBetter = req.LapMs is { } l && (rec.LapMs is null || l < rec.LapMs);
        bool driftBetter = req.Drift is { } dr && (rec.Drift is null || dr > rec.Drift);
        if (lapBetter) { rec.LapMs = req.LapMs; rec.LapAt = now; }
        if (driftBetter) { rec.Drift = req.Drift; rec.DriftAt = now; }
        await db.SaveChangesAsync();

        var scope = db.Records.Where(r => r.CarId == req.CarId && r.Track == req.Track);
        int? lapRank = rec.LapMs is { } myLap ? await scope.CountAsync(r => r.LapMs < myLap) + 1 : null;
        int? driftRank = rec.Drift is { } myDrift ? await scope.CountAsync(r => r.Drift > myDrift) + 1 : null;
        return new SubmitRecordResponse(lapBetter, lapRank, driftBetter, driftRank);
    }

    // GET /api/records/mine — all of the player's bests (for the info panel)
    [Authorize]
    [HttpGet("records/mine")]
    public async Task<List<MyRecordDto>> Mine()
    {
        var userId = User.UserId();
        return await db.Records.Where(r => r.UserId == userId)
            .Select(r => new MyRecordDto(r.CarId, r.Track, r.LapMs, r.Drift)).ToListAsync();
    }

    // GET /api/leaderboard?car=f40&track=circuit&type=lap|drift&take=10
    // The top results; a signed-in player outside the top also gets their own row at the end.
    [HttpGet("leaderboard")]
    public async Task<ActionResult<List<LeaderboardRow>>> Leaderboard(string car, string track = "circuit", string type = "lap", int take = 10)
    {
        if (!GameRules.IsCarId(car) || !GameRules.Tracks.Contains(track)) return BadRequest(new { error = "უცნობი მანქანა ან ტრასა." });
        take = Math.Clamp(take, 1, 50);
        var me = User.UserId();
        var scope = db.Records.Where(r => r.CarId == car && r.Track == track);
        bool lap = type != "drift";

        var top = await (lap
                ? scope.Where(r => r.LapMs != null).OrderBy(r => r.LapMs).ThenBy(r => r.LapAt)
                : scope.Where(r => r.Drift != null).OrderByDescending(r => r.Drift).ThenBy(r => r.DriftAt))
            .Take(take)
            .Select(r => new { r.UserId, r.User!.DisplayName, Value = lap ? r.LapMs!.Value : r.Drift!.Value, At = lap ? r.LapAt : r.DriftAt })
            .ToListAsync();
        var rows = top.Select((r, i) => new LeaderboardRow(i + 1, r.UserId, r.DisplayName, r.Value, r.At, r.UserId == me)).ToList();

        if (me is not null && rows.All(r => !r.Me))
        {
            var mine = await scope.Where(r => r.UserId == me).Select(r => new { r.LapMs, r.Drift, r.LapAt, r.DriftAt, r.User!.DisplayName }).FirstOrDefaultAsync();
            int? value = mine is null ? null : lap ? mine.LapMs : mine.Drift;
            if (mine is not null && value is { } v)
            {
                int rank = lap ? await scope.CountAsync(r => r.LapMs < v) + 1 : await scope.CountAsync(r => r.Drift > v) + 1;
                rows.Add(new LeaderboardRow(rank, me.Value, mine.DisplayName, v, lap ? mine.LapAt : mine.DriftAt, true));
            }
        }
        return rows;
    }

    // GET /api/leaderboard/best?car=f40 — the best lap and drift of everyone, per track
    // (shown on the track cards before a drive)
    [HttpGet("leaderboard/best")]
    public async Task<ActionResult<Dictionary<string, TrackBest>>> Best(string car)
    {
        if (!GameRules.IsCarId(car)) return BadRequest(new { error = "უცნობი მანქანა." });
        var result = new Dictionary<string, TrackBest>();
        foreach (var track in GameRules.Tracks)
        {
            var scope = db.Records.Where(r => r.CarId == car && r.Track == track);
            var lap = await scope.Where(r => r.LapMs != null).OrderBy(r => r.LapMs).ThenBy(r => r.LapAt)
                .Select(r => new TopResult(r.User!.DisplayName, r.LapMs!.Value)).FirstOrDefaultAsync();
            var drift = await scope.Where(r => r.Drift != null).OrderByDescending(r => r.Drift).ThenBy(r => r.DriftAt)
                .Select(r => new TopResult(r.User!.DisplayName, r.Drift!.Value)).FirstOrDefaultAsync();
            result[track] = new TrackBest(lap, drift);
        }
        return result;
    }
}
