namespace Veloce.Api.Models;

// A registered player. Passwords are stored only as salted hashes (ASP.NET Core PasswordHasher).
public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool IsAdmin { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<LapRecord> Records { get; set; } = [];
    public List<Favorite> Favorites { get; set; } = [];
    public List<Tuning> Tunings { get; set; } = [];
}
