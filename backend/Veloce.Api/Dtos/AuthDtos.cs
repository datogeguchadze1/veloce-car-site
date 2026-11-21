namespace Veloce.Api.Dtos;

public record RegisterRequest(string Email, string Password, string DisplayName);
public record LoginRequest(string Email, string Password);
public record UserDto(int Id, string Email, string DisplayName, bool IsAdmin);
public record AuthResponse(string Token, UserDto User);
