/* Shared upload flow: bounded file transfers, one server batch, searchable progress. */
(function () {
    'use strict';
    const labels = {pending: '等待入库', queued: '等待上传', uploading: '上传中', uploaded: '等待入库', processing: '识别与入库中', completed: '已可检索', failed: '失败'};
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const identifier = () => 'web_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);

    function render(target, snapshot) {
        target.hidden = false;
        target.replaceChildren();
        const heading = document.createElement('p');
        heading.className = 'batch-upload-heading';
        heading.setAttribute('role', 'status');
        heading.setAttribute('aria-live', 'polite');
        heading.textContent = `已可检索 ${snapshot.completed}/${snapshot.rows.length} · 失败 ${snapshot.failed} · 已用时 ${snapshot.seconds.toFixed(1)} 秒`;
        target.append(heading);
        const progress = document.createElement('progress');
        progress.max = snapshot.rows.length;
        progress.value = snapshot.completed + snapshot.failed;
        progress.setAttribute('aria-label', '文件入库进度');
        target.append(progress);
        const note = document.createElement('p');
        note.className = 'batch-upload-note';
        note.textContent = snapshot.done ? '成功入库的文件现在即可检索；AI 摘要和知识图谱由后台继续完善。' : '文件会陆续可检索，无需等待整批结束。AI 摘要和知识图谱在入库后由后台继续处理。';
        target.append(note);
        const list = document.createElement('ul');
        list.className = 'batch-upload-list';
        for (const row of snapshot.rows) {
            const item = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = row.file.name;
            const status = document.createElement('span');
            status.className = 'batch-upload-state ' + row.status;
            status.textContent = row.error ? `失败：${row.error}` : labels[row.status] || row.status;
            item.append(name, status);
            list.append(item);
        }
        target.append(list);
    }

    async function run({files, collectionId, title = '', request, onUpdate = () => {}}) {
        const rows = Array.from(files, file => ({file, id: identifier(), status: 'queued'}));
        if (!rows.length) throw new Error('请先选择文件');
        const started = performance.now();
        const snapshot = done => ({rows, done, completed: rows.filter(r => r.status === 'completed').length,
            failed: rows.filter(r => r.status === 'failed').length, seconds: (performance.now() - started) / 1000});
        const update = () => onUpdate(snapshot(false));
        const checked = async (url, options) => {
            const response = await request(url, options);
            if (response.success === false) throw new Error(response.message || '请求失败');
            return response.result;
        };
        let cursor = 0;
        update();
        await Promise.all(Array.from({length: Math.min(4, rows.length)}, async () => {
            while (cursor < rows.length) {
                const row = rows[cursor++];
                row.status = 'uploading'; update();
                const form = new FormData(); form.append('file', row.file);
                try {
                    row.upload = await checked('/api/v1/rag/multimodal/upload', {method: 'POST', body: form});
                    if (!row.upload?.url) throw new Error('上传响应缺少文件地址');
                    row.status = 'uploaded';
                } catch (error) { row.status = 'failed'; row.error = error.message; }
                update();
            }
        }));
        const accepted = rows.filter(row => row.status === 'uploaded');
        if (!accepted.length) { const result = snapshot(true); onUpdate(result); return result; }
        const resources = accepted.map(row => ({id: row.id, classifyId: collectionId,
            name: title ? (rows.length === 1 ? title : `${title} · ${row.file.name}`) : row.file.name,
            description: '通过知识库批量上传', type: 'file',
            content: {url: row.upload.url, md5: row.upload.md5, length: row.upload.size},
            parseOptions: {processing_mode: 'deferred'}}));
        const batch = await checked('/api/v1/rag/resource-parse/batch-parse', {method: 'POST', body: JSON.stringify({resources})});
        if (!batch?.batch_id) throw new Error('服务未返回批次编号，请先检查文档列表再重试');
        let failures = 0;
        const deadline = performance.now() + 30 * 60 * 1000;
        while (performance.now() < deadline) {
            let status;
            try {
                status = await checked('/api/v1/rag/resource-parse/batch-status', {method: 'POST', body: JSON.stringify({batch_id: batch.batch_id})});
                failures = 0;
            } catch (error) {
                if (++failures >= 5) throw new Error(`进度查询中断，后台任务可能仍在运行。批次 ${batch.batch_id}；请检查文档列表后再重试。${error.message}`);
                await sleep(1000); continue;
            }
            for (const resource of status.resources || []) {
                const row = accepted.find(row => row.id === resource.id);
                if (!row) continue;
                row.status = resource.status;
                row.contentId = resource.content_id;
                if (resource.status === 'failed') row.error = resource.message || '入库失败';
            }
            update();
            if (status.status === 'failed') throw new Error(`批次 ${batch.batch_id} 处理失败，请检查文档列表和失败文件。`);
            if (accepted.every(row => ['completed', 'failed'].includes(row.status))) {
                const result = {...snapshot(true), batchId: batch.batch_id}; onUpdate(result); return result;
            }
            await sleep(1000);
        }
        throw new Error(`进度查询超时，批次 ${batch.batch_id} 可能仍在后台处理，请检查文档列表。`);
    }
    window.KnowledgeBatchUpload = {run, render};
})();
