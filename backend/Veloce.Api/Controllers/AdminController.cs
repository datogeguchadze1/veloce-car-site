using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Veloce.Api.Data;
using Veloce.Api.Dtos;
using Veloce.Api.Models;
using Veloce.Api.Services;

namespace Veloce.Api.Controllers;

// The admin panel (admin.html): catalog texts, users and suspicious records.
[ApiController]
[Authorize]
[AdminOnly]
[Route("api/admin")]
public class AdminController(VeloceDbContext db) : ControllerBase
{
    private static readonly string[] SpecKeys = ["engine", "power", "accel", "top", "weight", "built"];

    // GET /api/admin/stats
    [HttpGet("stats")]
    public async Task<StatsDto> Stats() => new(
        await db.Users.CountAsync(), await db.Records.CountAsync(), await db.Tunings.CountAsync(),
        await db.Favorites.CountAsync(), await db.Cars.CountAsync());

    // GET /api/admin/cars — every car, hidden ones too
    [HttpGet("cars")]
    public async Task<List<CarDto>> Cars()
    {
        var cars = await db.Cars.OrderBy(c => c.SortOrder).ThenBy(c => c.Year).ToListAsync();
        return cars.Select(CarsController.ToDto).ToList();
    }

    // POST /api/admin/cars/seed  [ ...cars from js/models.js ] — adds the cars that are not in the
    // database yet (existing rows are left as edited)
    [HttpPost("cars/seed")]
    public async Task<ActionResult<object>> Seed(List<CarDto> cars)
    {
        var existing = (await db.Cars.Select(c => c.Id).ToListAsync()).ToHashSet();
        int added = 0, order = existing.Count;
        foreach (var dto in cars)
        {
            if (!GameRules.IsCarId(dto.Id) || existing.Contains(dto.Id)) continue;
            var car = new Car { Id = dto.Id, SortOrder = dto.SortOrder > 0 ? dto.SortOrder : ++order };
            var error = Apply(car, dto);
            if (error is not null) return BadRequest(new { error = $"{dto.Id}: {error}" });
            db.Cars.Add(car);
            existing.Add(dto.Id);
            added++;
        }
        await db.SaveChangesAsync();
        return new { added };
    }

    // PUT /api/admin/cars/f40  { ...CarDto }
    [HttpPut("cars/{id}")]
    public async Task<ActionResult<CarDto>> UpdateCar(string id, CarDto dto)
    {
        var car = await db.Cars.FindAsync(id);
        if (car is null) return NotFound(new { error = "მანქანა ვერ მოიძებნა." });
        var error = Apply(car, dto);
        if (error is not null) return BadRequest(new { error });
        car.Visible = dto.Visible;
        car.SortOrder = dto.SortOrder;
        car.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return CarsController.ToDto(car);
    }

    // DELETE /api/admin/cars/f40 — drops the database row (the car falls back to js/models.js)
    [HttpDelete("cars/{id}")]
    public async Task<IActionResult> DeleteCar(string id)
    {
        var n = await db.Cars.Where(c => c.Id == id).ExecuteDeleteAsync();
        return n == 0 ? NotFound(new { error = "მანქანა ვერ მოიძებნა." }) : NoContent();
    }

    // GET /api/admin/users
    [HttpGet("users")]
    public Task<List<UserAdminDto>> Users() =>
        db.Users.OrderBy(u => u.Id)
            .Select(u => new UserAdminDto(u.Id, u.Email, u.DisplayName, u.IsAdmin, u.CreatedAt, u.Records.Count, u.Tunings.Count))
            .ToListAsync();

    // PUT /api/admin/users/3/admin  { isAdmin: true }
    [HttpPut("users/{id:int}/admin")]
    public async Task<IActionResult> SetAdmin(int id, SetAdminRequest req)
    {
        if (id == User.UserId() && !req.IsAdmin) return BadRequest(new { error = "საკუთარ თავს ადმინის როლს ვერ ჩამოართმევ." });
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound(new { error = "მომხმარებელი ვერ მოიძებნა." });
        user.IsAdmin = req.IsAdmin;
        await db.SaveChangesAsync();
        return NoContent();
    }

    // DELETE /api/admin/users/3 — removes the account with its records, garage and tunings
    [HttpDelete("users/{id:int}")]
    public async Task<IActionResult> DeleteUser(int id)
    {
        if (id == User.UserId()) return BadRequest(new { error = "საკუთარ ანგარიშს აქედან ვერ წაშლი." });
        var n = await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync();
        return n == 0 ? NotFound(new { error = "მომხმარებელი ვერ მოიძებნა." }) : NoContent();
    }

    // GET /api/admin/records?take=100 — the newest results first
    [HttpGet("records")]
    public Task<List<AdminRecordDto>> Records(int take = 100) =>
        db.Records
            .OrderByDescending(r => (r.LapAt > r.DriftAt || r.DriftAt == null) ? r.LapAt : r.DriftAt)
            .Take(Math.Clamp(take, 1, 500))
            .Select(r => new AdminRecordDto(r.UserId, r.User!.DisplayName, r.CarId, r.Track, r.LapMs, r.Drift, r.LapAt, r.DriftAt))
            .ToListAsync();

    // DELETE /api/admin/records/3/f40/circuit?part=lap|drift|all
    [HttpDelete("records/{userId:int}/{carId}/{track}")]
    public async Task<IActionResult> DeleteRecord(int userId, string carId, string track, string part = "all")
    {
        var rec = await db.Records.FindAsync(userId, carId, track);
        if (rec is null) return NotFound(new { error = "რეკორდი ვერ მოიძებნა." });
        if (part == "lap") { rec.LapMs = null; rec.LapAt = null; }
        else if (part == "drift") { rec.Drift = null; rec.DriftAt = null; }
        if (part == "all" || (rec.LapMs is null && rec.Drift is null)) db.Records.Remove(rec);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // copies the editable fields; returns an error text or null
    private static string? Apply(Car car, CarDto dto)
    {
        string T(string? s, int max) => (s ?? "").Trim() is var t && t.Length > max ? t[..max] : (s ?? "").Trim();
        if (string.IsNullOrWhiteSpace(dto.Name) || string.IsNullOrWhiteSpace(dto.Brand)) return "მარკა და სახელი სავალდებულოა.";
        if (dto.Year is < 1880 or > 2100) return "წელი არასწორია.";
        if (dto.Vmax is < 0 or > 600 || dto.T100 is < 0 or > 60) return "სიჩქარის მონაცემები არასწორია.";
        car.Brand = T(dto.Brand, 60);
        car.Name = T(dto.Name, 80);
        car.Chassis = T(dto.Chassis, 40);
        car.Year = dto.Year;
        car.Years = T(dto.Years, 40);
        car.Body = T(dto.Body, 40);
        car.Era = T(dto.Era, 20);
        car.Description = T(dto.Desc, 2000);
        var specs = SpecKeys.ToDictionary(k => k, k => T(dto.Specs?.GetValueOrDefault(k), 80));
        car.SpecsJson = JsonSerializer.Serialize(specs);
        car.Vmax = dto.Vmax;
        car.T100 = dto.T100;
        return null;
    }
}
