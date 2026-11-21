using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Veloce.Api.Data;
using Veloce.Api.Dtos;
using Veloce.Api.Models;
using Veloce.Api.Services;

namespace Veloce.Api.Controllers;

// "My garage": starred cars and saved tuning sets. Every query is limited to the signed-in user.
[ApiController]
[Authorize]
[Route("api/garage")]
public class GarageController(VeloceDbContext db) : ControllerBase
{
    private const int MaxTunings = 60;
    private int Me => User.UserId()!.Value;

    // GET /api/garage → { favorites: [carId], tunings: [...] }
    [HttpGet]
    public async Task<GarageDto> Get()
    {
        var favs = await db.Favorites.Where(f => f.UserId == Me).OrderBy(f => f.CreatedAt).Select(f => f.CarId).ToListAsync();
        var tunings = await db.Tunings.Where(t => t.UserId == Me).OrderByDescending(t => t.UpdatedAt).ToListAsync();
        return new GarageDto(favs, tunings.Select(ToDto).ToList());
    }

    // PUT /api/garage/favorites/f40 — star a car
    [HttpPut("favorites/{carId}")]
    public async Task<IActionResult> AddFavorite(string carId)
    {
        if (!GameRules.IsCarId(carId)) return BadRequest(new { error = "უცნობი მანქანა." });
        if (!await db.Favorites.AnyAsync(f => f.UserId == Me && f.CarId == carId))
        {
            db.Favorites.Add(new Favorite { UserId = Me, CarId = carId });
            await db.SaveChangesAsync();
        }
        return NoContent();
    }

    // DELETE /api/garage/favorites/f40 — remove the star
    [HttpDelete("favorites/{carId}")]
    public async Task<IActionResult> RemoveFavorite(string carId)
    {
        await db.Favorites.Where(f => f.UserId == Me && f.CarId == carId).ExecuteDeleteAsync();
        return NoContent();
    }

    // POST /api/garage/tunings  { carId, name, settings: { color, finish, ... } }
    [HttpPost("tunings")]
    public async Task<ActionResult<TuningDto>> AddTuning(TuningRequest req)
    {
        if (!GameRules.IsCarId(req.CarId)) return BadRequest(new { error = "უცნობი მანქანა." });
        var name = CleanName(req.Name);
        if (name is null) return BadRequest(new { error = "სახელი უნდა იყოს 1–40 სიმბოლო." });
        var json = SettingsJson(req.Settings);
        if (json is null) return BadRequest(new { error = "ტუნინგის მონაცემები არასწორია." });
        if (await db.Tunings.CountAsync(t => t.UserId == Me) >= MaxTunings)
            return BadRequest(new { error = $"გარაჟში მაქსიმუმ {MaxTunings} ტუნინგი ეტევა." });

        var t = new Tuning { UserId = Me, CarId = req.CarId, Name = name, Json = json };
        db.Tunings.Add(t);
        await db.SaveChangesAsync();
        return ToDto(t);
    }

    // PUT /api/garage/tunings/5  { name?, settings? } — rename or overwrite
    [HttpPut("tunings/{id:int}")]
    public async Task<ActionResult<TuningDto>> UpdateTuning(int id, TuningRenameRequest req)
    {
        var t = await db.Tunings.FirstOrDefaultAsync(x => x.Id == id && x.UserId == Me);
        if (t is null) return NotFound(new { error = "ტუნინგი ვერ მოიძებნა." });
        if (req.Name is not null)
        {
            var name = CleanName(req.Name);
            if (name is null) return BadRequest(new { error = "სახელი უნდა იყოს 1–40 სიმბოლო." });
            t.Name = name;
        }
        if (req.Settings is { } s)
        {
            var json = SettingsJson(s);
            if (json is null) return BadRequest(new { error = "ტუნინგის მონაცემები არასწორია." });
            t.Json = json;
        }
        t.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return ToDto(t);
    }

    // DELETE /api/garage/tunings/5
    [HttpDelete("tunings/{id:int}")]
    public async Task<IActionResult> DeleteTuning(int id)
    {
        var n = await db.Tunings.Where(x => x.Id == id && x.UserId == Me).ExecuteDeleteAsync();
        return n == 0 ? NotFound(new { error = "ტუნინგი ვერ მოიძებნა." }) : NoContent();
    }

    private static string? CleanName(string? name)
    {
        var n = (name ?? "").Trim();
        return n.Length is >= 1 and <= 40 ? n : null;
    }

    // the settings must be a small JSON object; it is stored as sent
    private static string? SettingsJson(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object) return null;
        var json = settings.GetRawText();
        return json.Length <= GameRules.MaxTuningJson ? json : null;
    }

    private static TuningDto ToDto(Tuning t)
    {
        using var doc = JsonDocument.Parse(t.Json);
        return new TuningDto(t.Id, t.CarId, t.Name, doc.RootElement.Clone(), t.UpdatedAt);
    }
}
