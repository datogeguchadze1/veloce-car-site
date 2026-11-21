using System.Text.Json;

namespace Veloce.Api.Dtos;

public record TuningRequest(string CarId, string Name, JsonElement Settings);
public record TuningRenameRequest(string? Name, JsonElement? Settings);
public record TuningDto(int Id, string CarId, string Name, JsonElement Settings, DateTime UpdatedAt);
public record GarageDto(List<string> Favorites, List<TuningDto> Tunings);
