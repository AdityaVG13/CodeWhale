# HarmonyOS 与 OpenHarmony

> 英文原文：[HarmonyOS.md](../HarmonyOS.md)。
> 最后与英文同步日期（last synced with English revision）：2026-10-21。

本文讲 Codewhale 在 HarmonyOS PC 上运行，以及 OpenHarmony 的交叉编译环境。

## 支持层级

| 目标 | Codewhale 层级 | 验证方式 | 分发方式 |
| --- | --- | --- | --- |
| HarmonyOS PC 的 Linux 子系统（融合开发引擎，openEuler） | Tier 1 Linux ARM64 运行时 | 由 Linux ARM64 发布构建覆盖；没有在 Linux 子系统内运行的检查 | GitHub 发布的二进制文件；npm 为次要途径 |
| 原生 HarmonyOS 与 OpenHarmony（`aarch64-unknown-linux-ohos`） | Tier 2 交叉编译目标 | 手动触发 SDK 检查，覆盖 `codewhale-tui` 和 `codewhale-cli` | 从源码构建；没有预编译发布产物 |

Linux 子系统是运行 openEuler Linux 的虚拟机，因此使用 Linux ARM64 发布版。
原生 HarmonyOS 和 OpenHarmony 不是 Linux 发行版：它们的用户空间使用 OpenHarmony
基于 musl 的 C 库和系统接口，Codewhale 为它构建原生版本时使用
`aarch64-unknown-linux-ohos` 目标。Linux 发布二进制文件没有针对原生 HarmonyOS
构建或测试。

Tier 2 提供源码构建方式和手动触发的 SDK 检查，不代表每次提交都已通过编译检查，
也不承诺提供发布二进制文件或完整的设备级运行时测试。OpenHarmony 工作流使用已发布的 6.1 原生 SDK；
如果 SDK、Clang 或 sysroot 不可用，它会刻意失败，
而不是改用宿主头文件，或者用一个可能误报成功的桩（stub）来替代。

## 在 HarmonyOS PC 上运行

在 HarmonyOS PC 上，请在 Linux 子系统（融合开发引擎）里运行 Codewhale。华为将它
描述为“轻量级虚拟化开发环境（Linux子系统）”，当前版本仅支持 openEuler。
全新安装时，在 Linux 子系统里打开终端，用官方 GitHub 安装脚本：

```bash
curl -fsSL https://codewhale.net/install.sh | sh
"$HOME/.local/bin/codewhale" --version
```

[已发布的 v0.9.11 版本](https://github.com/codewhale-hq/CodeWhale/releases/tag/v0.9.11)
包含 `codewhale-linux-arm64` 和 `codew-linux-arm64`。各版本的具体要求和 Cargo 兜底方案见
[Linux ARM64 可移植性](./INSTALL.md#linux-arm64-可移植性)。
已经直接安装过的，用 `codewhale update`。目录已被占用，或者由包管理器管理的安装，
见[迁移到全新目录](./INSTALL.md#migrating-from-npm-cargo-or-another-installation)。
npm 仍是次要的打包途径；在 Linux 子系统里，它安装的是同样的 Linux ARM64 二进制文件。
在原生 HarmonyOS 终端里，Node 报告的平台是 `openharmony`。npm 在那里仍会尽力安装
静态链接的 Linux 构建，但它没有在原生 HarmonyOS 上测试过。如果二进制无法启动，
`codewhale` 会提示改用 Linux 子系统或从源码构建。安装脚本也会打印一条警告，
npm 7 及更高版本只在使用 `--foreground-scripts` 时才显示它。
`codewhale-tui-linux-arm64` 这个文件名只为兼容旧版更新器而保留，并不是第三条命令。

华为的 [Linux 子系统支持页面](https://consumer.huawei.com/cn/support/content/zh-cn16091898/)
（适用于 HarmonyOS 6.0、6.1 和 7.0 的台式机与笔记本；2026-10-21 核对）列出了以下限制：

- 当前版本融合开发引擎仅支持 openEuler。
- 不支持 `systemctl` 等服务管理工具；需要手动拉起服务，例如
  `sudo /usr/sbin/sshd`。
- 不支持对内核进行修改，`modinfo`、`modprobe`、`rmmod` 和 `insmod` 会报错。
- 不支持用 `mount` 命令直接挂载镜像。可以通过共享文件夹交换文件，它在 Linux
  里的路径是 `/mnt/linux_share`。共享文件夹内创建的文件为 root 属主，默认用户下
  `git clone` 可能失败；华为给出的替代做法是 `sudo git clone`。
- 暂不支持外接 USB 设备和 IPv6，也不支持用 `chsh` 修改登录默认 Shell。
- 最多支持保存 5 个快照。
- 仅支持在主用户（即电脑首次开机创建的用户）下安装使用。华为商用鸿蒙电脑系统版本为
  HarmonyOS 6.0.0.130 及以上时，也支持在个人空间安装使用。
- Docker 需要 HarmonyOS 7.0 及以上版本。

## 交叉编译到 OpenHarmony

仓库不把机器相关的 SDK 路径纳入版本控制。把 `OHOS_NATIVE_SDK` 设成 OpenHarmony
原生 SDK 目录，也就是包含 `llvm/bin`、`sysroot` 和
`build/cmake/ohos.toolchain.cmake` 的那个目录。

Windows PowerShell：

```powershell
$env:OHOS_NATIVE_SDK="<path-to-openharmony-native-sdk>"
. .\scripts\ohos-env.ps1
rustup target add aarch64-unknown-linux-ohos
$env:CODEWHALE_BUILD_SHA = (git rev-parse HEAD).Trim()
cargo build --locked --release --target aarch64-unknown-linux-ohos -p codewhale-cli
```

Linux 或 macOS：

```bash
export OHOS_NATIVE_SDK=/path/to/openharmony/native
. ./scripts/ohos-env.sh
rustup target add aarch64-unknown-linux-ohos
export CODEWHALE_BUILD_SHA="$(git rev-parse HEAD)"
cargo build --locked --release --target aarch64-unknown-linux-ohos -p codewhale-cli
```

默认可执行文件是 `target/aarch64-unknown-linux-ohos/release/codewhale`，在 Windows
上构建也没有 `.exe` 后缀。如果设置了 `CARGO_TARGET_DIR`，请使用对应的输出目录。
复制到设备后运行 `./codewhale --version`。使用上述提交标识时，应从没有未提交改动的源码构建。

这些环境准备脚本会为 `aarch64-unknown-linux-ohos` 导出 Cargo 的目标专用
`linker`、`AR`、`CC`、`CXX`、`CFLAGS`、`CXXFLAGS`、`CARGO_ENCODED_RUSTFLAGS`、
`CC_SHELL_ESCAPED_FLAGS`，以及 CMake 工具链变量。它们还会把 `bindgen` 指向 SDK 的
`libclang` 和 sysroot，好让 `rquickjs-sys` 生成 OpenHarmony 绑定；
`rquickjs-sys` 本身并不附带这些绑定的预生成版本。

在 Windows 上，`ohos-env.ps1` 让 Cargo 使用仓库里的 `ohos-clang.cmd` 启动器。
该启动器再委托给 `ohos-clang.ps1`，所以不只 C/C++ 编译和
bindgen，最终那次 Rust 链接也总会带上 `-target aarch64-linux-ohos`、
SDK sysroot 和 `-D__MUSL__`，同时保留 Cargo 的链接器参数和退出状态。启动器转发前会重新给每个参数加引号，
所以就算 SDK 路径里带空格（比如默认的 `D:\DevEco Studio\...` 安装），
到最终链接时 `--sysroot` 依然完好。

## 确认开发构建的版本

当前开发代码在 `main`。`0.10.2 (dev)` 表示构建时没有提供源码提交标识，并不是一个
开发更新频道，也不能证明已包含最新修复。上述命令会在 `--version` 中显示提交标识的
前 12 位。请同时记录完整的 `git rev-parse HEAD`。重新编译不会自动替换已安装的旧文件，
请检查实际复制到设备的可执行文件。

原生 OpenHarmony 目前没有预编译发布产物。在 HarmonyOS PC 上，Linux ARM64 发布文件
应在 Linux 子系统里使用，不是原生 OHOS 文件。GitHub 上仅构建的候选产物即使可下载，也只对应其标明的
源码提交，不代表原生 OHOS 已通过验证或正式版本已发布。

## 登录时的文件系统错误

`ChatGPT sign-in failed: opening filesystem root` 出现在准备本地凭据存储时，
早于浏览器登录和回调设置，单凭这条错误不能判断 `/tmp` 是否只读。当前源码在
Linux/OpenHarmony 上使用仅用于路径遍历的祖先目录句柄，最终的私有凭据目录仍使用
普通句柄并检查所有权和权限。打开根目录失败时，错误信息会包含操作系统的具体原因。

反馈时请附上准确的 `--version`、完整构建提交、设备与系统版本、终端版本及完整错误。
不要提供令牌、授权网址或凭据文件，也不要将系统目录改成可写或关闭凭据检查。
编译成功或 Linux 权限复现通过，仍不能代替在受影响设备上验证登录。

## 编译器包装脚本

临时手动调用编译器时，用 `scripts/ohos/` 里的包装脚本。它们读取同一个
`OHOS_NATIVE_SDK` 变量，脚本里不含本机路径。

Windows PowerShell：

```powershell
.\scripts\ohos\ohos-clang.ps1 --version
.\scripts\ohos\ohos-clangxx.ps1 --version
```

Linux 或 macOS：

```bash
sh ./scripts/ohos/ohos-clang.sh --version
sh ./scripts/ohos/ohos-clangxx.sh --version
```

如果你想直接用 `./scripts/ohos/ohos-clang.sh` 这样运行 POSIX 包装脚本，
先给它们加上可执行权限：

```bash
chmod +x ./scripts/ohos/ohos-clang.sh ./scripts/ohos/ohos-clangxx.sh
```

## 链接器与工具链路径

仓库不把 Cargo 链接器路径或 CMake 工具链路径纳入版本控制。Cargo 无法展开 `linker`
值或 CMake 工具链路径值里的环境变量，所以这些值改由 `scripts/ohos-env.ps1` 和
`scripts/ohos-env.sh` 导出。

## 依赖守卫

发布准备阶段会跑一次不依赖 SDK 的依赖检查：

```bash
./scripts/release/check-ohos-deps.sh
```

这个守卫会校验 Windows 最终链接包装脚本的约定，证明 OHOS 会启用 `rquickjs-sys` 的
bindgen feature，解析 `codewhale-tui` 在 `aarch64-unknown-linux-ohos` 下的依赖图，
并且在不受支持的宿主/UI crate 重新进入该依赖图时失败：`nix` 0.28/0.29、
`portable-pty`、`starlark`、`arboard` 或 `keyring`。这项无 SDK 检查不能代替真实的
SDK/sysroot 构建，但能在发布前抓住已知的链接器、bindgen、
`starlark -> rustyline -> nix` 以及 PTY/keyring 回归。

因为 OpenHarmony 的依赖图有意不含 `portable-pty`，常驻的 `terminal/*` PTY 工具
在该目标上不会注册。普通的 `exec_shell` 工具仍然可用，走的是非 PTY 的进程实现。

仅 Linux 的沙箱实现（bubblewrap、seccomp 和 `prctl` 进程加固）只为
`all(target_os = "linux", not(target_env = "ohos"))` 编译。因此 OpenHarmony
会报告“没有本地操作系统沙箱”，而不是去探测自己并不支持的 Linux 内核路径或系统调用。
配置好之后，外部 OpenSandbox 执行仍可单独使用。

原生桌面剪贴板库和 Wayland 辅助库也不进入 OpenHarmony 的依赖图。
文本复制降级为终端客户端路径（OSC 52；在 tmux 里则是 tmux 的 `load-buffer -w`）；
粘贴由终端提供，走普通输入或 bracketed 输入。图像剪贴板读取在该目标上不可用。
如果终端无法接受 OSC 52，复制会返回一条明确的“Clipboard unavailable”错误，
而不是 panic，也不会谎称成功。
