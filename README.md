# SLS Kibana 搭建指南

本文档用于指导用户从零搭建本项目。项目通过 Docker Compose 启动 Elasticsearch、kproxy、Kibana，并可选启动 `index-patterner` 自动创建 Kibana index pattern。

## 1. 环境准备

### 1.1 安装 Docker

先确认机器已经安装 Docker，并且 Docker 服务处于运行状态。

```bash
docker --version
docker compose version
```

如果命令不存在，请先安装 Docker Desktop 或 Docker Engine。建议使用支持 `docker compose` 子命令的较新版本。

### 1.2 准备机器资源

Elasticsearch 当前配置为：

```yaml
ES_JAVA_OPTS=-Xms2G -Xmx2G
```

因此建议机器至少准备：

- CPU：2 核或以上
- 内存：4 GB 或以上，建议 8 GB
- 磁盘：按日志查询规模预留，至少 10 GB 可用空间

如果机器内存不足，可以在 `docker-compose.yaml` 中调小 `ES_JAVA_OPTS`，例如：

```yaml
ES_JAVA_OPTS=-Xms1G -Xmx1G
```

## 2. 获取项目文件

将项目目录放到目标机器，例如：

```bash
cd /path/to
```

项目目录需要包含以下文件和目录：

```text
sls-kibana/
├── .env.example
├── docker-compose.yaml
├── patches/
│   ├── get_fields_stats.js
│   ├── kibana.yml
│   └── proxy.conf.example
└── README.md
```

其中：

- `.env.example`：环境变量模板。
- `docker-compose.yaml`：服务编排文件。
- `patches/kibana.yml`：Kibana 配置补丁。
- `patches/get_fields_stats.js`：Kibana 数据可视化补丁。
- `patches/proxy.conf.example`：kproxy Nginx 代理配置模板。

## 3. 创建数据目录

进入项目根目录：

```bash
cd /path/to/sls-kibana
```

创建 Elasticsearch 数据目录并赋权：

```bash
mkdir -p data
chmod 777 data
```

`chmod 777` 是为了避免容器内 Elasticsearch 用户没有权限写入数据目录。如果是生产环境，可以改成更严格的属主和权限配置，但必须保证容器内进程可写。

## 4. 配置环境变量

在项目根目录从模板创建 `.env` 文件：

```bash
cp .env.example .env
```

然后编辑 `.env`，填写实际配置：

```dotenv
ES_PASSWORD=请填写一个 Kibana/Elasticsearch 登录密码

SLS_ENDPOINT=cn-hangzhou.log.aliyuncs.com
SLS_PROJECT=请填写 SLS Project 名称
SLS_ACCESS_KEY_ID=请填写阿里云 AccessKey ID
SLS_ACCESS_KEY_SECRET=请填写阿里云 AccessKey Secret
```

示例：

```dotenv
ES_PASSWORD=YourStrongPassword
SLS_ENDPOINT=cn-hangzhou.log.aliyuncs.com
SLS_PROJECT=your-sls-project
SLS_ACCESS_KEY_ID=your-access-key-id
SLS_ACCESS_KEY_SECRET=your-access-key-secret
```

### 4.1 必填变量说明

| 变量名 | 说明 |
| --- | --- |
| `ES_PASSWORD` | Kibana 登录密码，也是 Kibana 连接 Elasticsearch 使用的密码。用户名固定为 `elastic`。 |
| `SLS_ENDPOINT` | SLS 地域 Endpoint，例如 `cn-hangzhou.log.aliyuncs.com`。 |
| `SLS_PROJECT` | SLS Project 名称。 |
| `SLS_ACCESS_KEY_ID` | 有权限访问该 SLS Project 的 AccessKey ID。 |
| `SLS_ACCESS_KEY_SECRET` | 有权限访问该 SLS Project 的 AccessKey Secret。 |

> 注意：不要把 `.env` 文件提交到公共仓库，也不要把 `docker compose config` 的完整输出发到公共渠道，因为它会展开并显示明文 AccessKey。

## 5. 检查代理补丁配置

当前项目会把 `patches/proxy.conf` 挂载到 kproxy 容器：

```yaml
./patches/proxy.conf:/etc/nginx/conf.d/proxy.conf:ro
```

仓库只提供脱敏模板。执行下面命令，脚本会读取 `.env` 并自动生成本地 `patches/proxy.conf`：

```bash
./scripts/generate-proxy-conf.sh
```

脚本会自动完成 Project、Endpoint 和 Basic Auth 的替换，并把生成文件权限设置为 `600`。生成的 `patches/proxy.conf` 包含真实 AccessKey 派生出的认证信息，已被 `.gitignore` 排除，不要提交到仓库。

这个文件包含具体的 SLS Project、Endpoint 和认证代理规则。新用户搭建时需要确认：

1. 修改 `.env` 后重新执行 `./scripts/generate-proxy-conf.sh`。
2. 如果切换到新的 AccessKey，重新执行脚本生成新的 `patches/proxy.conf`。

可以用下面命令快速检查当前代理配置中的 Project 和 Endpoint：

```bash
grep -E "proxy_pass|X-Project-Alias|location" patches/proxy.conf
```

如果你希望完全依赖 kproxy 镜像按环境变量生成默认配置，可以先咨询项目维护者是否可以移除 `docker-compose.yaml` 中 `kproxy` 服务的 `patches/proxy.conf` 挂载。

## 6. 启动服务

在项目根目录执行：

```bash
docker compose up -d
```

查看容器状态：

```bash
docker compose ps
```

正常情况下会看到以下服务：

- `es`
- `kproxy`
- `kibana`
- `index-patterner`

`index-patterner` 是可选初始化服务，用于自动创建 Kibana index pattern。它执行完成后退出是正常现象。

## 7. 查看启动日志

首次启动 Kibana 需要等待一段时间。可以查看日志确认启动进度：

```bash
docker compose logs -f es
docker compose logs -f kproxy
docker compose logs -f kibana
```

看到 Kibana 日志中出现服务已监听或 ready 相关信息后，再访问页面。

## 8. 访问 Kibana

浏览器打开：

```text
http://localhost:5601
```

如果部署在远程服务器，将 `localhost` 替换成服务器 IP 或域名：

```text
http://服务器IP:5601
```

登录信息：

```text
用户名：elastic
密码：.env 中的 ES_PASSWORD
```

登录后进入 Kibana，可在 Discover 中选择自动创建的 index pattern 查询 SLS 日志。

## 9. ARM 机器适配

如果部署机器是 Apple Silicon 或 ARM 架构服务器，需要在 `docker-compose.yaml` 中切换 ARM 镜像。

例如将：

```yaml
image: sls-registry.cn-hangzhou.cr.aliyuncs.com/kproxy/elasticsearch:7.17.26
```

改成：

```yaml
image: sls-registry.cn-hangzhou.cr.aliyuncs.com/kproxy/elasticsearch:7.17.26-arm64
```

`kproxy` 和 `kibana` 也同样切换到带 `-arm64` 后缀的镜像。Compose 文件里已经保留了对应注释行，取消 ARM 镜像注释并注释掉原镜像即可。

## 10. 常用操作

### 10.1 停止服务

```bash
docker compose down
```

这会停止并删除容器，但不会删除 `data/` 中的 Elasticsearch 数据。

### 10.2 重启服务

```bash
docker compose restart
```

### 10.3 修改配置后重新加载

如果修改了 `.env` 或 `docker-compose.yaml`：

```bash
docker compose up -d
```

如果修改了 `patches/proxy.conf`，建议重启 kproxy：

```bash
docker compose restart kproxy
```

如果修改了 `patches/kibana.yml` 或 Kibana 补丁文件，建议重启 Kibana：

```bash
docker compose restart kibana
```

### 10.4 清空本地 Elasticsearch 数据

谨慎操作。该命令会删除本地 Kibana 配置、索引模式等 Elasticsearch 数据：

```bash
docker compose down
rm -rf data/*
mkdir -p data
chmod 777 data
docker compose up -d
```

## 11. 常见问题

### 11.1 Kibana 打不开

先检查容器是否启动：

```bash
docker compose ps
```

再查看 Kibana 日志：

```bash
docker compose logs -f kibana
```

常见原因：

- Kibana 首次启动较慢，还没有 ready。
- 端口 `5601` 被占用。
- Elasticsearch 没有启动成功。
- `.env` 中 `ES_PASSWORD` 缺失或与已有 Elasticsearch 数据中的密码不一致。

### 11.2 Elasticsearch 启动失败

查看日志：

```bash
docker compose logs -f es
```

常见原因：

- `data/` 目录没有写权限。
- 机器内存不足。
- 之前使用过不同密码或不同版本启动，旧数据与当前配置不兼容。

### 11.3 登录失败

确认用户名和密码：

```text
用户名：elastic
密码：.env 中的 ES_PASSWORD
```

如果是已经启动过的环境，修改 `.env` 中的 `ES_PASSWORD` 不一定会改变旧 Elasticsearch 数据里的密码。可以恢复原密码，或者在确认不需要旧数据后清空 `data/` 重新初始化。

### 11.4 查不到 SLS 日志

重点检查：

- `SLS_ENDPOINT` 是否填写正确。
- `SLS_PROJECT` 是否填写正确。
- AccessKey 是否有效，并且有访问 SLS Project 和 Logstore 的权限。
- `patches/proxy.conf` 中的 Project 和 Endpoint 是否与 `.env` 一致。

## 12. 最小搭建命令汇总

下面是一组最小可执行命令，适合首次搭建时按顺序执行：

```bash
cd /path/to/sls-kibana

mkdir -p data
chmod 777 data

cp .env.example .env

# 编辑 .env，填入实际 SLS 配置和 AccessKey。
./scripts/generate-proxy-conf.sh

docker compose up -d
docker compose ps
docker compose logs -f kibana
```

Kibana 启动完成后访问：

```text
http://localhost:5601
```
