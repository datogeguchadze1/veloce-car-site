namespace Veloce.Api.Models;

// A named tuning set saved by a player (colour, finish, rims, ride height, tint, lights, interior).
// The settings are stored as the same JSON object the front end applies with car.applyTuning().
public class Tuning
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string CarId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Json { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
