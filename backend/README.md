# VELOCE Garage API (C#, ASP.NET Core + SQL Server)

საიტის ბექენდი: ანგარიშები, საერთო ლიდერბორდი, „ჩემი გარაჟი“ (რჩეული მანქანები და ტუნინგები) და ადმინ-პანელი. მონაცემები ინახება **Microsoft SQL Server**-ში, **Entity Framework Core**-ის საშუალებით.

- .NET 10 (LTS), ASP.NET Core Web API, კონტროლერები
- EF Core 10 + SQL Server, მიგრაციები (`Migrations/`)
- JWT ავტორიზაცია, პაროლების ჰეში (`PasswordHasher`), შესვლის მცდელობების ლიმიტი
- Swagger (ტესტირებისთვის ბრაუზერში), `Veloce.Api.http` (მოთხოვნები Visual Studio-დან)

## Visual Studio-ში გახსნა

1. საჭიროა **Visual Studio 2026** (ან 2022 17.14+) და კომპონენტი **ASP.NET and web development**.
2. **File → Open → Project/Solution** → `backend/Veloce.sln`.
3. დააყენე connection string (ქვემოთ, „საიდუმლოები“).
4. **F5**: გაიხსნება ბრაუზერი `http://localhost:5080`-ზე. ერთი და იგივე მისამართი ემსახურება 3D საიტსაც და API-საც (`/api/...`), ამიტომ შესვლა, გარაჟი და ლიდერბორდი მაშინვე მუშაობს.
   - გაშვების პროფილი **Swagger** (F5-ის გვერდით ისარი): API-ს სატესტო გვერდი, `/swagger`.
   - პირველი გაშვებისას ბაზაში ცხრილები თავისით იქმნება (`Database.Migrate()`).

### საიდუმლოები (connection string)
რეპოზიტორია საჯაროა, ამიტომ პაროლები `appsettings.json`-ში **არ** იწერება. Visual Studio-ში:
**Solution Explorer → `Veloce.Api`-ზე მარჯვენა ღილაკი → Manage User Secrets**, და ჩაწერე:

```json
{
  "ConnectionStrings": {
    "Veloce": "Server=SERVER;Database=DATABASE;User Id=USER;Password=PASSWORD;TrustServerCertificate=True;"
  },
  "Jwt": {
    "Key": "აქ ჩაწერე შემთხვევითი გრძელი სტრიქონი, მინიმუმ 32 სიმბოლო"
  },
  "Admin": {
    "Emails": [ "შენი@ელფოსტა.ge" ]
  }
}
```

ეს ფაილი ინახება შენს კომპიუტერზე, პროექტის გარეთ, და GitHub-ზე არასდროს ხვდება.
- `Admin:Emails`: ამ ელ-ფოსტით რეგისტრაცია ან შესვლა ავტომატურად ადმინად გხდის. სია თუ ცარიელია, ადმინი ხდება პირველი დარეგისტრირებული ანგარიში.
- `Jwt:Key`: Development-ში თუ არ დააყენე, დროებითი გასაღები შეიქმნება (გადატვირთვისას შესვლა გაუქმდება). სერვერზე სავალდებულოა.

## სტრუქტურა

| ფაილი | რა არის შიგნით |
|---|---|
| `Program.cs` | სერვისების რეგისტრაცია: ბაზა, JWT, ლიმიტი, CORS, Swagger, საიტის ფაილები, მიგრაცია გაშვებისას |
| `Data/VeloceDbContext.cs` | EF Core კონტექსტი: ცხრილები, გასაღებები, ინდექსები |
| `Models/` | ცხრილები: `User`, `LapRecord` (`Records`), `Favorite`, `Tuning`, `Car` |
| `Dtos/` | API-ს მოთხოვნები და პასუხები |
| `Controllers/AuthController.cs` | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| `Controllers/RecordsController.cs` | `POST /api/records`, `GET /api/records/mine`, `GET /api/leaderboard`, `GET /api/leaderboard/best` |
| `Controllers/GarageController.cs` | `GET /api/garage`, რჩეულები (`PUT`/`DELETE /api/garage/favorites/{car}`), ტუნინგები (`/api/garage/tunings`) |
| `Controllers/CarsController.cs` | `GET /api/cars`, `GET /api/cars/hidden`: ადმინის მიერ შეცვლილი კატალოგი |
| `Controllers/AdminController.cs` | `/api/admin/...`: სტატისტიკა, მანქანები, მომხმარებლები, რეკორდები (მხოლოდ ადმინს) |
| `Controllers/HealthController.cs` | `GET /api/health`: მუშაობს თუ არა API და ბაზა |
| `Services/` | JWT ტოკენი, თამაშის წესები (ტრასები, დროის ზღვრები), ადმინის შემოწმება |
| `Migrations/` | ბაზის სქემა (EF Core მიგრაცია) |
| `Veloce.Api.http` | მზა მოთხოვნები Visual Studio-დან გასაგზავნად |
| `../tests/api-smoke.mjs` | ავტომატური შემოწმება გაშვებულ API-ზე: `node backend/tests/api-smoke.mjs` |

### ცხრილები
- **Users**: ელ-ფოსტა (უნიკალური), სახელი, პაროლის ჰეში, ადმინია თუ არა.
- **Records**: თითო მომხმარებელს, მანქანას და ტრასას ერთი ჩანაწერი აქვს: საუკეთესო წრე (მილიწამი) და საუკეთესო დრიფტი.
- **Favorites**: რჩეული მანქანები.
- **Tunings**: შენახული ტუნინგი (JSON: ფერი, საფარი, დისკები, სიმაღლე, ტონირება, ფარები, სალონი).
- **Cars**: კატალოგის ტექსტები, რომლებსაც ადმინი ცვლის. 3D მოდელების პარამეტრები `js/models.js`-ში რჩება.

### ბაზის შეცვლა
მოდელში ველის დამატების შემდეგ: **Tools → NuGet Package Manager → Package Manager Console**:
```
Add-Migration ველის_სახელი
Update-Database
```
(ტერმინალში: `dotnet ef migrations add ველის_სახელი`, `dotnet ef database update`.)

## როგორ მუშაობს საიტთან ერთად
- საიტი (`js/api.js`) ჯერ ამოწმებს `GET /api/health`-ს. თუ პასუხი არ მოვიდა (მაგ. GitHub Pages), ანგარიშის ღილაკები იმალება და საიტი მუშაობს როგორც ადრე: რეკორდები და ტუნინგი ბრაუზერში ინახება.
- შესვლის შემდეგ ტოკენი ინახება ბრაუზერში და იგზავნება `Authorization: Bearer ...` სათაურით.
- ტესტ-დრაივზე დასრულებული წრე და დრიფტი სერვერზე იგზავნება მხოლოდ მაშინ, როცა შენს საუკეთესო შედეგს აუმჯობესებს. HUD-ზე ჩანს ადგილი („🏆 ადგილი #3“).
- ადმინ-პანელი: `admin.html` (მენიუში „⚙ ადმინ-პანელი“). პირველად დააჭირე „🌱 შევსება models.js-იდან“: კატალოგის ტექსტები ბაზაში გადავა და იქიდან შეიცვლება.

## ატვირთვა ინტერნეტში (Azure-ის გარეშე)
Netlify მხოლოდ სტატიკურ საიტს და JavaScript ფუნქციებს უშვებს, C#-ს ვერ. ამიტომ:

1. **API** იტვირთება ASP.NET Core ჰოსტინგზე, მაგალითად [MonsterASP.NET](https://www.monsterasp.net/) (უფასო გეგმა: .NET 10 და MSSQL ბაზა). Visual Studio-ში: **`Veloce.Api`-ზე მარჯვენა ღილაკი → Publish**, და ჰოსტინგის publish profile.
   ჰოსტინგის პანელში დააყენე environment variables (ან `appsettings.Production.json` პირდაპირ სერვერზე):
   - `ConnectionStrings__Veloce`
   - `Jwt__Key`
   - `Admin__Emails__0`
2. **საიტი** იტვირთება Netlify-ზე (`netlify.toml` უკვე მზადაა). ფაილში მოხსენი კომენტარი `/api/*` წესს და ჩაწერე API-ს მისამართი. Netlify `/api`-ს API-ზე გადაამისამართებს, ამიტომ საიტსა და API-ს ერთი მისამართი აქვთ.
3. შემოწმება: `https://შენი-საიტი.netlify.app/api/health` → `{"ok":true,"db":true}`.

SQL Server ინტერნეტიდან ხელმისაწვდომი უნდა იყოს: კომპიუტერზე დაყენებულ ლოკალურ სერვერს ჰოსტინგი ვერ მიწვდება. ყველაზე მარტივია ჰოსტინგის საკუთარი MSSQL ბაზა.
