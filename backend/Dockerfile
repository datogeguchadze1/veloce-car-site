# The API as a container image: Vercel (Container runtime) builds this file when the Vercel
# project's Root Directory is "backend". Also runs anywhere Docker runs.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Veloce.Api/Veloce.Api.csproj Veloce.Api/
RUN dotnet restore Veloce.Api/Veloce.Api.csproj
COPY Veloce.Api/ Veloce.Api/
RUN dotnet publish Veloce.Api/Veloce.Api.csproj -c Release --no-restore -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish ./
# Vercel sends traffic to port 80 unless PORT is set in the project; Program.cs listens on PORT.
# The base image runs as the non-root "app" user, which may not bind port 80, so run as root.
USER root
ENV PORT=80 ASPNETCORE_ENVIRONMENT=Production DOTNET_EnableDiagnostics=0
ENTRYPOINT ["dotnet", "Veloce.Api.dll"]
