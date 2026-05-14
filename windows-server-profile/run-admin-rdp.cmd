@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoExit -NoProfile -ExecutionPolicy Bypass -File \"C:\projects\windows-server-profile\20-enable-rdp.ps1\" -UserName \"DESKTOP-GT8NM2N\user\" -AllowedSubnet \"192.168.88.0/24\" -Port 3389'"

