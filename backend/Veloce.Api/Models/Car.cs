namespace Veloce.Api.Models;

// Catalog text for one car, editable in the admin panel. The id matches js/models.js; the 3D
// loading options stay in js/models.js because they are tied to the model files.
public class Car
{
    public string Id { get; set; } = "";
    public string Brand { get; set; } = "";
    public string Name { get; set; } = "";
    public string Chassis { get; set; } = "";
    public int Year { get; set; }
    public string Years { get; set; } = "";
    public string Body { get; set; } = "";
    public string Era { get; set; } = "";
    public string Description { get; set; } = "";
    public string SpecsJson { get; set; } = "{}";    // { engine, power, accel, top, weight, built }
    public int Vmax { get; set; }                    // test drive: top speed, km/h
    public double T100 { get; set; }                 // test drive: 0–100 km/h, seconds
    public bool Visible { get; set; } = true;
    public int SortOrder { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
