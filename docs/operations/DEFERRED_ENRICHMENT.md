# 先入库，后台完善 AI 摘要和知识图谱

上传流程默认使用 `processing_mode=deferred`：提取正文、生成基础摘要、写入正文向量和集合关联后，文档即为可检索状态。AI 摘要、摘要向量更新和知识图谱构建由持久化后台队列继续完成。图片正文仍需经过图片识别；图片识别成功时，优先复用同一次识别生成的摘要，避免重复调用大模型。

## 调用方式

资源解析请求的 `parseOptions` 可指定：

```json
{"processing_mode": "deferred"}
```

需要等待摘要和图谱完成的旧流程，可设置 `{"processing_mode":"sync"}`。实例默认模式由 `UPLOAD_PROCESSING_MODE` 控制，缺省为 `deferred`。

首页上传使用 `deferred`。解析正文超过 3,000 字符时，后台摘要覆盖所有分段，再分组汇总，生成全文摘要。界面在等待期间单独展示基础摘要；全文摘要失败不会影响正文检索。已完成的历史摘要保留原样，历史文档不会自动重新排队。

## 状态语义

`processing_status=completed` 表示正文向量入库完成，可供检索。`content_metadata.enrichment.status` 单独表示后台 AI 进度：`pending`、`running`、`completed` 或 `failed`。资源 Markdown 查询接口同时返回 `processing_status`、`processing_message` 和 `enrichment`；调用方判断 AI 是否全部完成时应读取 `enrichment`，不能只依赖入库状态。

`enrichment.summary`、`enrichment.profile` 和 `enrichment.knowledge_graph` 记录分阶段结果。图谱被配置关闭、未配置后端或正文不足最小长度时，该阶段为 `skipped`，原因一并返回。

首页文档详情从 `POST /api/v1/rag/documents/get` 读取正文和初始状态。后台处理中只刷新 `GET /api/v1/rag/documents/{document_id}/enrichment`，不重复传输正文。关联知识按需从 `GET /api/v1/rag/documents/{document_id}/relations` 读取，仅展示来自当前文档的关系。

图谱服务保留原有的关键词降级机制。模型超时或抽取无有效结果时，图谱可能使用关键词规则构建；此时 `knowledge_graph.degraded=true`，`method=keyword_quality_fallback`。`completed` 表示该轮构建结束，不能据此认定图谱由大模型完整生成。

向量写入失败会使入库失败，不会返回“已可检索”。图片识别失败也会返回失败，不会将报错占位文本作为正文继续入库。

## 后台队列

启动时只自动创建新增的 `rag_enrichment_jobs` 表，不修改现有业务表。后台任务与入库完成状态在同一数据库事务中提交，文档临时文件删除后仍可基于数据库正文继续处理。

PostgreSQL 多进程部署使用事务咨询锁及任务租约，最多一个后台 AI 任务同时执行。默认每 2 秒轮询，120 秒租约每 20 秒续租；进程异常退出后任务可恢复。服务正常关闭会重新排队当前任务。失败最多尝试 3 次，已完成的摘要和图谱阶段会跳过，人工修改过的摘要和标签会保留。重新上传同一资源会使旧任务失效，过期结果不会覆盖新正文。

可选配置：

```dotenv
UPLOAD_PROCESSING_MODE=deferred
UPLOAD_ENRICHMENT_WORKER_ENABLED=true
UPLOAD_ENRICHMENT_POLL_SECONDS=2
UPLOAD_ENRICHMENT_MAX_ATTEMPTS=3
```

数据库用于持久化任务，无需引入 Redis。后台阶段失败不会撤销已入库正文及正文向量。失败状态会保留错误信息，供运维定位。

## 耗时边界

“先入库”缩短上传后等待可检索的时间，不代表模型推理本身加速。图片识别仍受图片尺寸、模型负载和排队影响；长文档仍受解析和向量化影响。对外报告耗时时，应分别报告“可检索耗时”和“后台 AI 全部完成耗时”，并注明文件类型、规模及测量时负载。

## 相同图片识别结果复用

默认开启图片解析缓存：相同用户、相同知识库集合内，文件 SHA-256、模型地址与名称、提示词、缩放及输出配置均一致时，复用此前成功识别的正文和结构化摘要。默认有效期为 24 小时，读取不会延长有效期。缓存只保存纯解析内容，不复制来源资源标识、权限、集合关系或人工修改后的正文。每次上传仍独立执行向量入库、集合关联及后台任务登记。

成功识别会在向量入库前单独持久化，因此向量写入失败后重试也可复用识别结果。同一进程中，同时到达的相同图片会等待首次识别并复用结果；多进程可复用已经落库的结果，但不同进程首次同时处理同一图片仍可能分别调用模型。上线前的历史图片没有解析快照，首次重传仍需识别。

需要重新识别时使用 `parseOptions.force_reprocess=true`；模型在原地址、原名称下更新权重时，修改 `VLM_IMAGE_CACHE_VERSION` 可使旧缓存失效。

```dotenv
VLM_IMAGE_CACHE_ENABLED=true
VLM_IMAGE_CACHE_TTL_SECONDS=86400
VLM_IMAGE_CACHE_VERSION=1
VLM_IMAGE_REQUEST_TIMEOUT=180
VLM_IMAGE_MAX_RETRIES=1
```

图片请求默认最多尝试一次、单次超时 180 秒，避免在模型繁忙时每 60 秒重复提交。此配置仅影响单图解析，不改变视频帧的通用重试配置；减少重试也不意味着单次模型推理加速。失败仍会明确返回，可由用户稍后重新处理。

`VLM_IMAGE_MAX_EDGE=1280` 可在送入视觉模型前缩小图片。当前缺省值为 `0`，保留原图；小字扫描件和密集表格应先用实际样本核对识别质量，再调整此设置。首次出现的新图片仍受视觉推理和排队耗时约束，不能用缓存命中的耗时代替首次识别耗时。

## 新图片先 OCR 入库

`deferred` 模式的图片默认采用 `image_processing_mode=auto`：先请求已配置的 OCR 服务，识别到至少 2 个文本块、20 个字符，字符加权平均置信度达到 0.90，且每个文本块置信度都达到 0.80，才使用 OCR 正文入库。保留全部返回文本块，不通过删除低置信度词来凑合格结果；OCR 不可用、超时、文本太少、结果格式错误或置信度不足时，回到原视觉模型解析。置信度只是接纳条件，不能保证没有漏检或识别错误，实际文件仍需按业务样本核对。

合格结果标记 `content_metadata.image_content_scope=recognized_text`，`content_metadata.ocr` 记录引擎、置信度和耗时。该正文表示图片中识别出的文字，适合截图、扫描件和文字记录；不会同时生成完整场景描述，也不承诺还原复杂表格的行列关系。基础摘要和正文向量先完成，AI 摘要与图谱由既有持久化队列根据 OCR 正文继续处理。后台不依赖上传临时图片，因此文件清理后仍可继续。

照片、图表或需要完整视觉语义的资源可设置：

```json
{"processing_mode":"deferred","image_processing_mode":"vision"}
```

`sync` 模式缺省保持 `vision`。`force_reprocess=true` 表示跳过解析缓存，仍按选定的 `auto` 或 `vision` 路径重新处理。OCR 结果也受同用户、同集合、文件 SHA-256 和配置签名隔离，调整 OCR 版本或质量阈值会使旧缓存失效。

### OCR 服务部署

`deploy/ocr/server.py` 将 RapidOCR 的 PP-OCRv4 模型常驻 CPU 内存，知识库通过 HTTP 调用；不修改知识库 Python 依赖，不占用生成模型或向量模型的加速卡。服务不持久化图片，默认限制请求 20 MiB、单帧 2500 万像素。每个并发槽使用独立模型实例，同一实例不会同时推理；缺省 2 个实例、每实例 8 个 CPU 线程。另允许最多 8 个请求等待，等待超过 12 秒返回忙；入队请求在获得实例后才解码，避免所有等待请求同时保留完整像素数组。客户端读超时缺省 20 秒，失败后走视觉模型。

独立构建与启动：

```sh
docker compose -f deploy/ocr/compose.yml up -d --build
```

默认主机端口只绑定 `127.0.0.1:8014`。原生或 host-network 知识库可直接使用默认地址；桥接容器中的知识库需要与 OCR 容器共享内网，将 `IMAGE_OCR_API_URL` 配为该容器的服务地址，不要使用宿主机的回环地址。OCR 服务端口不应直接暴露到公网。

配置示例：

```dotenv
IMAGE_OCR_ENABLED=true
IMAGE_OCR_API_URL=http://127.0.0.1:8014/ocr
IMAGE_OCR_VERSION=rapidocr-v4-1
IMAGE_OCR_TIMEOUT=20
IMAGE_OCR_MIN_CONFIDENCE=0.9
IMAGE_OCR_MIN_BLOCK_CONFIDENCE=0.8
IMAGE_OCR_MIN_CHARS=20
IMAGE_OCR_MIN_BLOCKS=2
```

OCR 检测图最长边 736，识别裁剪区域使用原图。通过 OCR 服务的 `OCR_WORKERS`、`OCR_THREADS`、`OCR_MAX_WAITING`、`OCR_QUEUE_TIMEOUT`、`OCR_DET_MAX_EDGE` 调整；Compose 缺省 CPU 上限 16 核、内存上限 4 GiB。OpenCV 缺省保持库的线程配置，可通过 `OCR_OPENCV_THREADS` 设置正整数线程数；不强制更改系统内存分配器参数。增加实例数应同时核对 CPU、内存和峰值负载，多实例不能沿用单实例的低内存配额。


改变模型或处理配置后同时更新服务端 `OCR_MODEL_VERSION` 与知识库的 `IMAGE_OCR_VERSION`。缩小检测图可能漏掉细小文字，即使其余文字置信度较高也不能识别这种漏检，应使用 `vision` 或更高检测分辨率处理这类文件。

性能报告应注明模型是否已常驻、文件哈希是否首次出现、是否命中解析缓存，并包含向量入库与立即检索验证。新文件遇到繁忙排队、低质量识别或视觉模型回退时，会超过 OCR 成功路径的耗时。
