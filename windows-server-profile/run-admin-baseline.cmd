@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoExit -NoProfile -ExecutionPolicy Bypass -File \"C:\projects\windows-server-profile\10-apply-server-baseline.ps1\" -SetPrivateNetwork -DisableHibernation -DisableConsumerStartup -DisablePrinting -DisableBluetooth'"
