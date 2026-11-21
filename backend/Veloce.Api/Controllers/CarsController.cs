using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Veloce.Api.Data;
using Veloce.Api.Dtos;
using Veloce.Api.Models;

namespace Veloce.Api.Controllers;

[ApiController]
[Route("api/cars")]
public class CarsController(VeloceDbContext db) : ControllerBase
{
    // GET /api/cars — the catalog texts from the database (only visible cars). The front end lays
    // them over js/models.js; an empty list means "use js/models.js as it is".
    [HttpGet]
    public async Task<List<CarDto>> Get()
    {
        var cars = await db.Cars.Where(c => c.Visible).OrderBy(c => c.SortOrder).ThenBy(c => c.Year).ToListAsync();
        return cars.Select(ToDto).ToList();
    }

    // GET /api/cars/hidden — ids the admin hid, so the catalog can leave them out
    [HttpGet("hidden")]
    public Task<List<string>> Hidden() => db.Cars.Where(c => !c.Visible).Select(c => c.Id).ToListAsync();

    internal static CarDto ToDto(Car c) => new(
        c.Id, c.Brand, c.Name, c.Chassis, c.Year, c.Years, c.Body, c.Era, c.Description,
        JsonSerializer.Deserialize<Dictionary<string, string>>(c.SpecsJson) ?? [], c.Vmax, c.T100, c.Visible, c.SortOrder);
}
