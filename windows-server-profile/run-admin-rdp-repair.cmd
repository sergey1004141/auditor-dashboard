@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoExit -NoProfile -ExecutionPolicy Bypass -File \"C:\projects\windows-server-profile\21-repair-rdp-listener.ps1\" -AllowedSubnet \"192.168.1.0/24\" -Port 3389'"
