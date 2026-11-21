namespace Veloce.Api.Models;

// A car the player starred in "My garage".
public class Favorite
{
    public int UserId { get; set; }
    public User? User { get; set; }
    public string CarId { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
