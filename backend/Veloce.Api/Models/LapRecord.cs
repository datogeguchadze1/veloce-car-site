namespace Veloce.Api.Models;

// A player's best result with one car on one test-drive track: one row per (user, car, track).
// The lap time and the drift score are kept separately because they are set in different drives.
public class LapRecord
{
    public int UserId { get; set; }
    public User? User { get; set; }
    public string CarId { get; set; } = "";
    public string Track { get; set; } = "";
    public int? LapMs { get; set; }          // best lap, milliseconds (lower is better)
    public DateTime? LapAt { get; set; }
    public int? Drift { get; set; }          // best single drift, points (higher is better)
    public DateTime? DriftAt { get; set; }
}
