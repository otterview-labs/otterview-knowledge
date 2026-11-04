/**
 * 企业知识库API客户端
 * 提供完整的API接口调用封装
 */

class EnterpriseApiClient {
    constructor(baseUrl = '/api/v1/enterprise', apiKey = null) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.headers = {
            'Content-Type': 'application/json'
        };
        
        if (apiKey) {
            this.headers['Authorization'] = `Bearer ${apiKey}`;
        }
    }

    /**
     * 通用请求方法
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: this.headers,
            ...options
        };

        try {
            const response = await fetch(url, config);
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.message || `API请求失败: ${response.status}`);
            }
            
            return result;
        } catch (error) {
            console.error('API请求错误:', error);
            throw error;
        }
    }

    // ============ 知识检索API ============
    
    /**
     * 智能搜索
     * POST /api/v1/enterprise/search
     */
    async search(params) {
        return this.request('/search', {
            method: 'POST',
            body: JSON.stringify({
                query: params.query,                    // 搜索关键词
                search_type: params.searchType || 'hybrid',  // 搜索类型: semantic/keyword/hybrid
                top_k: params.topK || 10,              // 返回结果数量
                similarity_threshold: params.threshold || 0.3,  // 相似度阈值
                collection_id: params.collectionId,    // 指定集合ID
                filters: params.filters || {},         // 筛选条件
                include_metadata: params.includeMetadata || true,  // 是否包含元数据
                rerank: params.rerank || true           // 是否重排序
            })
        });
    }

    /**
     * 多层次检索
     * POST /api/v1/enterprise/multi-search
     */
    async multiLayerSearch(params) {
        return this.request('/multi-search', {
            method: 'POST', 
            body: JSON.stringify({
                query: params.query,
                layers: params.layers || ['semantic', 'keyword', 'kg'],  // 检索层次
                top_k_per_layer: params.topKPerLayer || 5,
                final_k: params.finalK || 10,
                fusion_strategy: params.fusionStrategy || 'weighted',  // 融合策略
                enable_rerank: params.enableRerank || true
            })
        });
    }

    // ============ 知识库管理API ============
    
    /**
     * 获取知识库列表
     * POST /api/v1/enterprise/knowledge/list
     */
    async getKnowledgeList(pageRequest) {
        return this.request('/knowledge/list', {
            method: 'POST',
            body: JSON.stringify(pageRequest)
        });
    }

    /**
     * 创建知识条目
     * POST /api/v1/enterprise/knowledge/create
     */
    async createKnowledge(knowledge) {
        return this.request('/knowledge/create', {
            method: 'POST',
            body: JSON.stringify({
                title: knowledge.title,
                content: knowledge.content,
                tags: knowledge.tags || [],
                category_id: knowledge.categoryId,
                metadata: knowledge.metadata || {},
                status: knowledge.status || 'draft'
            })
        });
    }

    /**
     * 更新知识条目
     * POST /api/v1/enterprise/knowledge/update
     */
    async updateKnowledge(knowledgeId, updates) {
        return this.request('/knowledge/update', {
            method: 'POST',
            body: JSON.stringify({
                knowledge_id: knowledgeId,
                ...updates
            })
        });
    }

    /**
     * 删除知识条目
     * POST /api/v1/enterprise/knowledge/delete
     */
    async deleteKnowledge(knowledgeId) {
        return this.request('/knowledge/delete', {
            method: 'POST',
            body: JSON.stringify({
                knowledge_id: knowledgeId
            })
        });
    }

    /**
     * 批量操作
     * POST /api/v1/enterprise/knowledge/batch
     */
    async batchKnowledgeOperation(operation, knowledgeIds, params = {}) {
        return this.request('/knowledge/batch', {
            method: 'POST',
            body: JSON.stringify({
                operation: operation,  // create/update/delete/publish/archive
                knowledge_ids: knowledgeIds,
                params: params
            })
        });
    }

    // ============ 数据源管理API ============
    
    /**
     * 获取数据源列表
     * POST /api/v1/enterprise/datasources/list
     */
    async getDataSources(pageRequest) {
        return this.request('/datasources/list', {
            method: 'POST',
            body: JSON.stringify(pageRequest)
        });
    }

    /**
     * 创建数据源连接
     * POST /api/v1/enterprise/datasources/create
     */
    async createDataSource(dataSource) {
        return this.request('/datasources/create', {
            method: 'POST',
            body: JSON.stringify({
                name: dataSource.name,
                type: dataSource.type,  // office/email/im/web/database/api
                config: dataSource.config,
                sync_config: dataSource.syncConfig || {},
                enabled: dataSource.enabled !== false
            })
        });
    }

    /**
     * 启动数据采集任务
     * POST /api/v1/enterprise/datasources/sync/start
     */
    async startDataSync(dataSourceId, params = {}) {
        return this.request('/datasources/sync/start', {
            method: 'POST',
            body: JSON.stringify({
                datasource_id: dataSourceId,
                sync_type: params.syncType || 'incremental',  // full/incremental
                force_refresh: params.forceRefresh || false
            })
        });
    }

    /**
     * 停止数据采集任务
     * POST /api/v1/enterprise/datasources/sync/stop
     */
    async stopDataSync(dataSourceId) {
        return this.request('/datasources/sync/stop', {
            method: 'POST',
            body: JSON.stringify({
                datasource_id: dataSourceId
            })
        });
    }

    /**
     * 获取同步状态
     * POST /api/v1/enterprise/datasources/sync/status
     */
    async getSyncStatus(dataSourceId = null) {
        return this.request('/datasources/sync/status', {
            method: 'POST',
            body: JSON.stringify({
                datasource_id: dataSourceId
            })
        });
    }

    // ============ 向量库管理API ============
    
    /**
     * 获取向量库状态
     * GET /api/v1/enterprise/vectordb/status
     */
    async getVectorDBStatus() {
        return this.request('/vectordb/status', {
            method: 'GET'
        });
    }

    /**
     * 切换向量数据库引擎
     * POST /api/v1/enterprise/vectordb/switch-engine
     */
    async switchVectorEngine(engineType, config = {}) {
        return this.request('/vectordb/switch-engine', {
            method: 'POST',
            body: JSON.stringify({
                engine_type: engineType,  // faiss/milvus/pinecone/weaviate
                config: config,
                migrate_data: config.migrateData || false
            })
        });
    }

    /**
     * 优化向量索引
     * POST /api/v1/enterprise/vectordb/optimize
     */
    async optimizeVectorDB(params = {}) {
        return this.request('/vectordb/optimize', {
            method: 'POST',
            body: JSON.stringify({
                optimization_type: params.type || 'index_rebuild',  // index_rebuild/compress/cleanup
                collection_id: params.collectionId
            })
        });
    }

    // ============ 知识图谱API ============
    
    /**
     * 构建知识图谱
     * POST /api/v1/enterprise/kg/build
     */
    async buildKnowledgeGraph(params) {
        return this.request('/kg/build', {
            method: 'POST',
            body: JSON.stringify({
                content_id: params.contentId,
                text_content: params.textContent,
                extraction_type: params.extractionType || 'both',
                max_entities: params.maxEntities || 50,
                max_relations: params.maxRelations || 100,
                store_to_neo4j: params.storeToNeo4j || true
            })
        });
    }

    /**
     * 查询知识图谱
     * POST /api/v1/enterprise/kg/query
     */
    async queryKnowledgeGraph(query, params = {}) {
        return this.request('/kg/query', {
            method: 'POST',
            body: JSON.stringify({
                query: query,  // Cypher查询或自然语言查询
                query_type: params.queryType || 'natural',  // cypher/natural
                limit: params.limit || 50
            })
        });
    }

    // ============ 权限管理API ============
    
    /**
     * 验证用户权限
     * POST /api/v1/enterprise/auth/verify
     */
    async verifyPermission(resource, action, userId = null) {
        return this.request('/auth/verify', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                resource: resource,
                action: action
            })
        });
    }

    /**
     * 获取用户角色
     * POST /api/v1/enterprise/auth/roles
     */
    async getUserRoles(userId = null) {
        return this.request('/auth/roles', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId
            })
        });
    }

    /**
     * 设置用户权限
     * POST /api/v1/enterprise/auth/set-permission
     */
    async setUserPermission(userId, permissions) {
        return this.request('/auth/set-permission', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                permissions: permissions
            })
        });
    }

    // ============ 分析统计API ============
    
    /**
     * 获取访问统计
     * GET /api/v1/enterprise/analytics/access
     */
    async getAccessAnalytics(timeRange = '7d') {
        return this.request(`/analytics/access?time_range=${timeRange}`, {
            method: 'GET'
        });
    }

    /**
     * 获取搜索统计
     * GET /api/v1/enterprise/analytics/search
     */
    async getSearchAnalytics(timeRange = '7d') {
        return this.request(`/analytics/search?time_range=${timeRange}`, {
            method: 'GET'
        });
    }

    /**
     * 获取用户行为分析
     * POST /api/v1/enterprise/analytics/user-behavior
     */
    async getUserBehaviorAnalytics(params) {
        return this.request('/analytics/user-behavior', {
            method: 'POST',
            body: JSON.stringify({
                user_id: params.userId,
                time_range: params.timeRange || '7d',
                metrics: params.metrics || ['visits', 'searches', 'downloads']
            })
        });
    }

    /**
     * 获取热门内容
     * GET /api/v1/enterprise/analytics/hot-content
     */
    async getHotContent(limit = 20, timeRange = '7d') {
        return this.request(`/analytics/hot-content?limit=${limit}&time_range=${timeRange}`, {
            method: 'GET'
        });
    }

    // ============ 标签管理API ============
    
    /**
     * 获取所有标签
     * GET /api/v1/enterprise/tags
     */
    async getTags() {
        return this.request('/tags', {
            method: 'GET'
        });
    }

    /**
     * 创建标签
     * POST /api/v1/enterprise/tags/create
     */
    async createTag(tag) {
        return this.request('/tags/create', {
            method: 'POST',
            body: JSON.stringify({
                name: tag.name,
                color: tag.color || '#667eea',
                description: tag.description,
                category: tag.category
            })
        });
    }

    /**
     * 获取推荐标签
     * POST /api/v1/enterprise/tags/recommend
     */
    async getRecommendedTags(content) {
        return this.request('/tags/recommend', {
            method: 'POST',
            body: JSON.stringify({
                content: content,
                max_tags: 10
            })
        });
    }

    // ============ 版本控制API ============
    
    /**
     * 创建新版本
     * POST /api/v1/enterprise/versions/create
     */
    async createVersion(contentId, versionData) {
        return this.request('/versions/create', {
            method: 'POST',
            body: JSON.stringify({
                content_id: contentId,
                version_type: versionData.type || 'minor',  // major/minor/patch
                description: versionData.description,
                changes: versionData.changes || []
            })
        });
    }

    /**
     * 版本对比
     * POST /api/v1/enterprise/versions/compare
     */
    async compareVersions(contentId, version1, version2) {
        return this.request('/versions/compare', {
            method: 'POST',
            body: JSON.stringify({
                content_id: contentId,
                version_1: version1,
                version_2: version2
            })
        });
    }

    /**
     * 恢复版本
     * POST /api/v1/enterprise/versions/restore
     */
    async restoreVersion(contentId, version) {
        return this.request('/versions/restore', {
            method: 'POST',
            body: JSON.stringify({
                content_id: contentId,
                version: version,
                create_backup: true
            })
        });
    }

    // ============ 生命周期管理API ============
    
    /**
     * 更新内容状态
     * POST /api/v1/enterprise/lifecycle/update-status
     */
    async updateContentStatus(contentId, status, comment = '') {
        return this.request('/lifecycle/update-status', {
            method: 'POST',
            body: JSON.stringify({
                content_id: contentId,
                status: status,  // draft/review/approved/published/archived/deprecated
                comment: comment
            })
        });
    }

    /**
     * 批量状态更新
     * POST /api/v1/enterprise/lifecycle/batch-update-status
     */
    async batchUpdateStatus(contentIds, status, comment = '') {
        return this.request('/lifecycle/batch-update-status', {
            method: 'POST',
            body: JSON.stringify({
                content_ids: contentIds,
                status: status,
                comment: comment
            })
        });
    }

    /**
     * 获取生命周期统计
     * GET /api/v1/enterprise/lifecycle/stats
     */
    async getLifecycleStats() {
        return this.request('/lifecycle/stats', {
            method: 'GET'
        });
    }

    // ============ API密钥管理 ============
    
    /**
     * 创建API密钥
     * POST /api/v1/enterprise/api-keys/create
     */
    async createApiKey(keyData) {
        return this.request('/api-keys/create', {
            method: 'POST',
            body: JSON.stringify({
                name: keyData.name,
                permissions: keyData.permissions || [],
                expires_at: keyData.expiresAt,
                rate_limit: keyData.rateLimit || 1000
            })
        });
    }

    /**
     * 撤销API密钥
     * POST /api/v1/enterprise/api-keys/revoke
     */
    async revokeApiKey(keyId) {
        return this.request('/api-keys/revoke', {
            method: 'POST',
            body: JSON.stringify({
                key_id: keyId
            })
        });
    }

    /**
     * 获取API使用统计
     * POST /api/v1/enterprise/api-keys/usage-stats
     */
    async getApiUsageStats(keyId, timeRange = '7d') {
        return this.request('/api-keys/usage-stats', {
            method: 'POST',
            body: JSON.stringify({
                key_id: keyId,
                time_range: timeRange
            })
        });
    }
}

// 全局实例
window.EnterpriseAPI = new EnterpriseApiClient();

// 导出为模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnterpriseApiClient;
}