@echo off
setlocal EnableExtensions

cd /d "%~dp0"
if errorlevel 1 goto :directory_error

title Genesis - Local Development

echo.
echo ========================================
echo          Genesis - One-Click Start
echo ========================================
echo.

call :require_command node "Node.js was not found. Install Node.js 20.19+ or 22.12+."
if errorlevel 1 goto :failed

call :require_command pnpm "pnpm was not found. Run: npm install -g pnpm"
if errorlevel 1 goto :failed

call :require_command docker "Docker was not found. Install and start Docker Desktop."
if errorlevel 1 goto :failed

docker compose version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose is unavailable. Install or update Docker Desktop.
    goto :failed
)

if not exist "package.json" (
    echo [ERROR] package.json was not found in the script directory.
    goto :failed
)

if not exist ".env" if not exist ".env.example" (
    echo [ERROR] Neither .env nor .env.example was found.
    goto :failed
)

if /i "%~1"=="--check" (
    echo [OK] Environment and project file checks passed.
    exit /b 0
)

if not exist ".env" (
    echo [1/5] Creating .env from .env.example...
    copy /y ".env.example" ".env" >nul
    if errorlevel 1 (
        echo [ERROR] Failed to create .env.
        goto :failed
    )
) else (
    echo [1/5] Existing .env found.
)

if not exist "node_modules\" (
    echo [2/5] Installing project dependencies...
    call pnpm install
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        goto :failed
    )
) else (
    echo [2/5] Existing node_modules found.
)

echo [3/5] Starting PostgreSQL...
docker compose up -d
if errorlevel 1 (
    echo [ERROR] PostgreSQL failed to start. Make sure Docker Desktop is running.
    goto :failed
)

echo [4/5] Applying database migrations...
call pnpm prisma migrate dev
if errorlevel 1 (
    echo [ERROR] Database migration failed. Check the database settings in .env.
    goto :failed
)

echo [5/5] Starting the development server...
echo The browser will open shortly: http://localhost:3000
echo Press Ctrl+C to stop the development server.
echo.

start "" /b cmd /d /c "timeout /t 5 /nobreak >nul & start http://localhost:3000"
call pnpm dev
set "DEV_EXIT=%ERRORLEVEL%"

echo.
if "%DEV_EXIT%"=="0" (
    echo Development server stopped.
) else (
    echo [ERROR] Development server exited with code %DEV_EXIT%.
)
pause
exit /b %DEV_EXIT%

:require_command
where "%~1" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] %~2
    exit /b 1
)
exit /b 0

:directory_error
echo [ERROR] Could not enter the script directory: %~dp0
goto :failed

:failed
echo.
echo Startup did not complete. Resolve the error above and try again.
pause
exit /b 1
