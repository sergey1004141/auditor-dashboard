@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -Verb RunAs -ArgumentList '/k C:\projects\windows-server-profile\install-admin-runner-task.cmd'"
