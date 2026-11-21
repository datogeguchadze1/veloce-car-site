namespace Veloce.Api.Dtos;

// Catalog text as the front end uses it (same field names as js/models.js).
public record CarDto(
    string Id, string Brand, string Name, string Chassis, int Year, string Years, string Body, string Era,
    string Desc, Dictionary<string, string> Specs, int Vmax, double T100, bool Visible, int SortOrder);

public record UserAdminDto(int Id, string Email, string DisplayName, bool IsAdmin, DateTime CreatedAt, int Records, int Tunings);
public record SetAdminRequest(bool IsAdmin);
public record StatsDto(int Users, int Records, int Tunings, int Favorites, int Cars);
