import { execFile } from "node:child_process";
import os from "node:os";

export class SystemStatusService {
  constructor() {
    this.previousCpuTimes = null;
  }

  async cpuMetrics() {
    const current = this.readCpuTimes();
    const previous = this.previousCpuTimes;
    this.previousCpuTimes = current;

    if (!previous) {
      return {
        sampledAt: new Date().toISOString(),
        cpuPercent: 0,
      };
    }

    const idleDelta = current.idle - previous.idle;
    const totalDelta = current.total - previous.total;
    const busyPercent = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;

    return {
      sampledAt: new Date().toISOString(),
      cpuPercent: Math.round(busyPercent * 10) / 10,
    };
  }

  async memoryMetrics() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    return {
      sampledAt: new Date().toISOString(),
      totalGB: this.bytesToGB(totalBytes),
      usedGB: this.bytesToGB(usedBytes),
      freeGB: this.bytesToGB(freeBytes),
      usedPercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
    };
  }

  async diskMetrics() {
    return this.runPowerShellJson(`
      $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
        Select-Object DeviceID,
          @{Name='SizeGB';Expression={[math]::Round($_.Size / 1GB, 2)}},
          @{Name='FreeGB';Expression={[math]::Round($_.FreeSpace / 1GB, 2)}},
          @{Name='UsedGB';Expression={[math]::Round(($_.Size - $_.FreeSpace) / 1GB, 2)}},
          @{Name='UsedPercent';Expression={[math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1)}}
      [pscustomobject]@{
        sampledAt = (Get-Date).ToString("o")
        disks = @($disks)
      }
    `);
  }

  async gpuMetrics() {
    return this.runPowerShellJson(`
      $gpuUtilization = $null
      try {
        $gpuSamples = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop
        $gpuUtilization = [math]::Round(
          ($gpuSamples.CounterSamples |
            Where-Object { $_.InstanceName -match 'engtype_3d|engtype_compute|engtype_copy|engtype_video' } |
            Measure-Object -Property CookedValue -Sum).Sum,
          1
        )
        if ($gpuUtilization -gt 100) { $gpuUtilization = 100 }
      } catch {
        $gpuUtilization = $null
      }
      [pscustomobject]@{
        sampledAt = (Get-Date).ToString("o")
        utilizationPercent = $gpuUtilization
      }
    `);
  }

  async runtimeMetrics() {
    return this.runPowerShellJson(`
      $os = Get-CimInstance Win32_OperatingSystem
      $computer = Get-CimInstance Win32_ComputerSystem
      $cpuLoad = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
      $gpuControllers = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
        Select-Object Name,
          @{Name='DriverVersion';Expression={$_.DriverVersion}},
          @{Name='AdapterRAMGB';Expression={if ($_.AdapterRAM) {[math]::Round($_.AdapterRAM / 1GB, 2)} else {$null}}}
      $gpuUtilization = $null
      try {
        $gpuSamples = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop
        $gpuUtilization = [math]::Round(
          ($gpuSamples.CounterSamples |
            Where-Object { $_.InstanceName -match 'engtype_3d|engtype_compute|engtype_copy|engtype_video' } |
            Measure-Object -Property CookedValue -Sum).Sum,
          1
        )
        if ($gpuUtilization -gt 100) { $gpuUtilization = 100 }
      } catch {
        $gpuUtilization = $null
      }
      $totalMemoryGB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 2)
      $freeMemoryGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
      $usedMemoryGB = [math]::Round($totalMemoryGB - $freeMemoryGB, 2)
      $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
        Select-Object DeviceID,
          @{Name='SizeGB';Expression={[math]::Round($_.Size / 1GB, 2)}},
          @{Name='FreeGB';Expression={[math]::Round($_.FreeSpace / 1GB, 2)}},
          @{Name='UsedGB';Expression={[math]::Round(($_.Size - $_.FreeSpace) / 1GB, 2)}},
          @{Name='UsedPercent';Expression={[math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1)}}
      [pscustomobject]@{
        sampledAt = (Get-Date).ToString("o")
        uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 2)
        cpuPercent = [math]::Round($cpuLoad, 1)
        memory = [pscustomobject]@{
          totalGB = $totalMemoryGB
          usedGB = $usedMemoryGB
          freeGB = $freeMemoryGB
          usedPercent = [math]::Round(($usedMemoryGB / $totalMemoryGB) * 100, 1)
        }
        disks = $disks
        gpu = [pscustomobject]@{
          utilizationPercent = $gpuUtilization
          controllers = @($gpuControllers)
        }
      }
    `);
  }

  async summary() {
    return this.runPowerShellJson(`
      $os = Get-CimInstance Win32_OperatingSystem
      $computer = Get-CimInstance Win32_ComputerSystem
      $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
      $volumes = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
        Select-Object DeviceID,
          @{Name='SizeGB';Expression={[math]::Round($_.Size / 1GB, 2)}},
          @{Name='FreeGB';Expression={[math]::Round($_.FreeSpace / 1GB, 2)}}
      [pscustomobject]@{
        computerName = $env:COMPUTERNAME
        user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        os = $os.Caption
        build = $os.BuildNumber
        lastBoot = $os.LastBootUpTime.ToString("o")
        uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 2)
        totalMemoryGB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 2)
        freeMemoryGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
        cpu = $cpu.Name
        logicalProcessors = $cpu.NumberOfLogicalProcessors
        disks = $volumes
      }
    `);
  }

  async services(names = []) {
    const safeNames = names
      .filter((name) => typeof name === "string" && /^[A-Za-z0-9 _.-]+$/.test(name))
      .map((name) => `"${name.replaceAll('"', '""')}"`);
    const serviceExpression = safeNames.length > 0 ? `@(${safeNames.join(",")})` : "@()";

    return this.runPowerShellJson(`
      $names = ${serviceExpression}
      if ($names.Count -eq 0) {
        $names = @(
          "Audiosrv","AudioEndpointBuilder","WlanSvc","Wcmsvc","Adguard VPN Service",
          "bthserv","BTAGService","Spooler","DiagTrack","WSearch","SysMain",
          "GfExperienceService","NvStreamSvc","NvStreamNetworkSvc","NvNetworkService",
          "TermService","UmRdpService","SessionEnv","WinDefend","mpssvc"
        )
      }
      Get-Service -Name $names -ErrorAction SilentlyContinue |
        Select-Object Name,DisplayName,
          @{Name='Status';Expression={$_.Status.ToString()}},
          @{Name='StartType';Expression={$_.StartType.ToString()}} |
        Sort-Object Name
    `);
  }

  async rdpStatus() {
    return this.runPowerShellJson(`
      $terminal = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server'
      $rdpTcp = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp'
      $service = Get-Service TermService -ErrorAction SilentlyContinue
      $listeners = Get-NetTCPConnection -LocalPort $rdpTcp.PortNumber -State Listen -ErrorAction SilentlyContinue |
        Select-Object LocalAddress,LocalPort,OwningProcess
      $rdpGroup = Get-LocalGroup -SID "S-1-5-32-555" -ErrorAction SilentlyContinue
      $users = if ($rdpGroup) {
        Get-LocalGroupMember -Group $rdpGroup.Name -ErrorAction SilentlyContinue |
          Select-Object Name,ObjectClass,PrincipalSource
      } else {
        @()
      }
      $firewall = Get-NetFirewallRule -Name 'RemoteDesktop-UserMode-In-TCP' -ErrorAction SilentlyContinue |
        Select-Object DisplayName,Enabled,Profile,Action
      $addressFilter = Get-NetFirewallRule -Name 'RemoteDesktop-UserMode-In-TCP' -ErrorAction SilentlyContinue |
        Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue |
        Select-Object RemoteAddress
      [pscustomobject]@{
        enabled = ($terminal.fDenyTSConnections -eq 0)
        port = $rdpTcp.PortNumber
        nla = ($rdpTcp.UserAuthentication -eq 1)
        securityLayer = $rdpTcp.SecurityLayer
        certificateThumbprint = $rdpTcp.SSLCertificateSHA1Hash
        termService = if ($service) { [pscustomobject]@{ status = $service.Status.ToString(); startType = $service.StartType.ToString() } } else { $null }
        listening = @($listeners)
        firewall = $firewall
        remoteAddress = $addressFilter.RemoteAddress
        remoteDesktopUsers = @($users)
      }
    `);
  }

  async networkStatus() {
    return this.runPowerShellJson(`
      $profiles = Get-NetConnectionProfile |
        Select-Object Name,InterfaceAlias,
          @{Name='NetworkCategory';Expression={$_.NetworkCategory.ToString()}},
          @{Name='IPv4Connectivity';Expression={$_.IPv4Connectivity.ToString()}},
          @{Name='IPv6Connectivity';Expression={$_.IPv6Connectivity.ToString()}}
      $ips = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '169.254.*' } |
        Select-Object IPAddress,InterfaceAlias,PrefixLength,
          @{Name='AddressState';Expression={$_.AddressState.ToString()}}
      $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Select-Object LocalAddress,LocalPort,OwningProcess |
        Sort-Object LocalPort
      [pscustomobject]@{
        profiles = $profiles
        ipv4 = $ips
        listeningPorts = @($listeners)
      }
    `);
  }

  async powerStatus() {
    return this.runPowerShellJson(`
      $scheme = powercfg /getactivescheme
      $standby = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE
      [pscustomobject]@{
        activeScheme = $scheme
        standbyRaw = $standby
      }
    `);
  }

  async recentEvents({ hours = 24, maxEvents = 30 } = {}) {
    const boundedHours = Math.min(Math.max(Number(hours) || 24, 1), 168);
    const boundedMax = Math.min(Math.max(Number(maxEvents) || 30, 1), 100);
    return this.runPowerShellJson(`
      Get-WinEvent -FilterHashtable @{
        LogName='System'
        Level=1,2,3
        StartTime=(Get-Date).AddHours(-${boundedHours})
      } -MaxEvents ${boundedMax} |
        Select-Object TimeCreated,ProviderName,Id,LevelDisplayName,Message
    `);
  }

  runPowerShellJson(script) {
    return new Promise((resolve, reject) => {
      const wrapped = `
        $ErrorActionPreference = 'Stop'
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $result = & {
          ${script}
        }
        $result | ConvertTo-Json -Depth 8
      `;
      execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapped],
        { windowsHide: true, timeout: 15000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || error.message).trim()));
            return;
          }

          const text = stdout.trim();
          if (!text) {
            resolve(null);
            return;
          }

          try {
            resolve(JSON.parse(text));
          } catch {
            resolve({ raw: text });
          }
        },
      );
    });
  }

  readCpuTimes() {
    return os.cpus().reduce(
      (summary, cpu) => {
        const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
        summary.idle += cpu.times.idle;
        summary.total += total;
        return summary;
      },
      { idle: 0, total: 0 },
    );
  }

  bytesToGB(bytes) {
    return Math.round((bytes / 1024 ** 3) * 100) / 100;
  }
}
