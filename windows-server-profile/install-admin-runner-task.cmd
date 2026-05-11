@echo off
schtasks /Create /TN "Auditor Admin Runner" /XML "C:\projects\windows-server-profile\AuditorAdminRunner.xml" /F
