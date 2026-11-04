// 智能体编排器
class Orchestrator {
    constructor() {
        this.nodes = new Map();
        this.connections = new Map();
        this.selectedNode = null;
        this.selectedConnection = null;
        this.draggedNode = null;
        this.dragOffset = { x: 0, y: 0 };
        this.connecting = false;
        this.connectionStart = null;
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.nodeCounter = 0;
        this.init();
    }

    // 初始化
    init() {
        this.checkAuth();
        this.initCanvas();
        this.initToolPanel();
        this.initPropertyPanel();
        this.initEventListeners();
        this.loadWorkflow();
    }

    // 检查认证状态
    checkAuth() {
        if (!Utils.isLoggedIn()) {
            Utils.navigate('/static/login.html');
            return;
        }
    }

    // 初始化画布
    initCanvas() {
        this.canvas = document.querySelector('.canvas');
        this.canvasContent = document.querySelector('.canvas-content');
        
        if (!this.canvas || !this.canvasContent) {
            console.error('Canvas elements not found');
            return;
        }

        // 创建SVG层用于连接线
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.style.position = 'absolute';
        this.svg.style.top = '0';
        this.svg.style.left = '0';
        this.svg.style.width = '100%';
        this.svg.style.height = '100%';
        this.svg.style.pointerEvents = 'none';
        this.canvasContent.appendChild(this.svg);
    }

    // 初始化工具面板
    initToolPanel() {
        this.renderToolCategories();
    }

    // 渲染工具分类
    renderToolCategories() {
        const toolCategories = document.querySelector('.tool-categories');
        if (!toolCategories) return;

        const categories = this.getToolCategories();
        toolCategories.innerHTML = categories.map(category => `
            <div class="tool-category">
                <div class="category-title">${category.title}</div>
                ${category.tools.map(tool => `
                    <div class="tool-item" draggable="true" data-tool-type="${tool.type}">
                        <div class="tool-icon ${tool.category}">
                            <i class="${tool.icon}"></i>
                        </div>
                        <div class="tool-info">
                            <h4>${tool.name}</h4>
                            <p>${tool.description}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');

        this.bindToolDragEvents();
    }

    // 获取工具分类数据
    getToolCategories() {
        return [
            {
                title: 'LLM 模型',
                tools: [
                    {
                        type: 'llm_chat',
                        name: '对话模型',
                        description: '大语言模型对话',
                        icon: 'fas fa-comments',
                        category: 'llm'
                    },
                    {
                        type: 'llm_completion',
                        name: '文本补全',
                        description: '文本生成和补全',
                        icon: 'fas fa-pen',
                        category: 'llm'
                    }
                ]
            },
            {
                title: '工具组件',
                tools: [
                    {
                        type: 'web_search',
                        name: '网页搜索',
                        description: '搜索网络信息',
                        icon: 'fas fa-search',
                        category: 'tool'
                    },
                    {
                        type: 'code_executor',
                        name: '代码执行',
                        description: '执行Python代码',
                        icon: 'fas fa-code',
                        category: 'tool'
                    },
                    {
                        type: 'file_reader',
                        name: '文件读取',
                        description: '读取和解析文件',
                        icon: 'fas fa-file-alt',
                        category: 'tool'
                    }
                ]
            },
            {
                title: '记忆组件',
                tools: [
                    {
                        type: 'vector_memory',
                        name: '向量记忆',
                        description: '向量存储和检索',
                        icon: 'fas fa-database',
                        category: 'memory'
                    },
                    {
                        type: 'chat_memory',
                        name: '对话记忆',
                        description: '对话历史存储',
                        icon: 'fas fa-history',
                        category: 'memory'
                    }
                ]
            },
            {
                title: '控制组件',
                tools: [
                    {
                        type: 'condition',
                        name: '条件判断',
                        description: '条件分支控制',
                        icon: 'fas fa-code-branch',
                        category: 'control'
                    },
                    {
                        type: 'loop',
                        name: '循环控制',
                        description: '循环执行逻辑',
                        icon: 'fas fa-redo',
                        category: 'control'
                    }
                ]
            }
        ];
    }

    // 绑定工具拖拽事件
    bindToolDragEvents() {
        const toolItems = document.querySelectorAll('.tool-item');
        toolItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('tool-type', item.dataset.toolType);
                item.classList.add('dragging');
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
            });
        });
    }

    // 初始化属性面板
    initPropertyPanel() {
        this.updatePropertyPanel();
    }

    // 初始化事件监听器
    initEventListeners() {
        // 画布拖放事件
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const toolType = e.dataTransfer.getData('tool-type');
            if (toolType) {
                const rect = this.canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left - this.pan.x) / this.zoom;
                const y = (e.clientY - rect.top - this.pan.y) / this.zoom;
                this.createNode(toolType, x, y);
            }
        });

        // 画布点击事件
        this.canvas.addEventListener('click', (e) => {
            if (e.target === this.canvas || e.target === this.canvasContent) {
                this.deselectAll();
            }
        });

        // 缩放控制
        document.getElementById('zoomIn')?.addEventListener('click', () => {
            this.setZoom(this.zoom * 1.2);
        });

        document.getElementById('zoomOut')?.addEventListener('click', () => {
            this.setZoom(this.zoom / 1.2);
        });

        document.getElementById('zoomReset')?.addEventListener('click', () => {
            this.setZoom(1);
        });

        // 保存按钮
        document.getElementById('saveBtn')?.addEventListener('click', () => {
            this.saveWorkflow();
        });

        // 运行按钮
        document.getElementById('runBtn')?.addEventListener('click', () => {
            this.runWorkflow();
        });

        // 键盘事件
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && this.selectedNode) {
                this.deleteNode(this.selectedNode);
            }
        });
    }

    // 创建节点
    createNode(toolType, x, y) {
        const nodeId = `node_${++this.nodeCounter}`;
        const toolInfo = this.getToolInfo(toolType);
        
        const nodeElement = document.createElement('div');
        nodeElement.className = 'node appear';
        nodeElement.dataset.nodeId = nodeId;
        nodeElement.style.left = `${x}px`;
        nodeElement.style.top = `${y}px`;
        
        nodeElement.innerHTML = `
            <div class="node-header">
                <div class="tool-icon ${toolInfo.category}">
                    <i class="${toolInfo.icon}"></i>
                </div>
                <h4 class="node-title">${toolInfo.name}</h4>
                <button class="node-menu">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </div>
            <div class="node-content">
                ${this.renderNodeParams(toolInfo.params)}
            </div>
            <div class="connection-point input"></div>
            <div class="connection-point output"></div>
        `;

        this.canvasContent.appendChild(nodeElement);

        // 存储节点数据
        this.nodes.set(nodeId, {
            id: nodeId,
            type: toolType,
            x: x,
            y: y,
            params: this.getDefaultParams(toolInfo.params),
            element: nodeElement
        });

        // 绑定节点事件
        this.bindNodeEvents(nodeElement, nodeId);

        return nodeId;
    }

    // 获取工具信息
    getToolInfo(toolType) {
        const toolMap = {
            llm_chat: {
                name: '对话模型',
                icon: 'fas fa-comments',
                category: 'llm',
                params: [
                    { name: 'model', label: '模型', type: 'select', options: ['gpt-4', 'gpt-3.5-turbo', 'claude-3'], default: 'gpt-4' },
                    { name: 'system_prompt', label: '系统提示', type: 'textarea', default: '你是一个有用的AI助手' },
                    { name: 'temperature', label: '温度', type: 'number', default: 0.7, min: 0, max: 2, step: 0.1 }
                ]
            },
            web_search: {
                name: '网页搜索',
                icon: 'fas fa-search',
                category: 'tool',
                params: [
                    { name: 'query', label: '搜索关键词', type: 'text', default: '' },
                    { name: 'max_results', label: '最大结果数', type: 'number', default: 5, min: 1, max: 20 }
                ]
            },
            code_executor: {
                name: '代码执行',
                icon: 'fas fa-code',
                category: 'tool',
                params: [
                    { name: 'language', label: '编程语言', type: 'select', options: ['python', 'javascript', 'bash'], default: 'python' },
                    { name: 'code', label: '代码', type: 'textarea', default: '' }
                ]
            }
        };

        return toolMap[toolType] || {
            name: '未知工具',
            icon: 'fas fa-question',
            category: 'tool',
            params: []
        };
    }

    // 渲染节点参数
    renderNodeParams(params) {
        if (!params || params.length === 0) return '';

        return params.map(param => {
            switch (param.type) {
                case 'text':
                    return `
                        <div class="node-param">
                            <div class="param-label">${param.label}</div>
                            <input type="text" class="param-input" name="${param.name}" value="${param.default || ''}">
                        </div>
                    `;
                case 'textarea':
                    return `
                        <div class="node-param">
                            <div class="param-label">${param.label}</div>
                            <textarea class="param-textarea" name="${param.name}">${param.default || ''}</textarea>
                        </div>
                    `;
                case 'number':
                    return `
                        <div class="node-param">
                            <div class="param-label">${param.label}</div>
                            <input type="number" class="param-input" name="${param.name}" 
                                   value="${param.default || 0}"
                                   min="${param.min || ''}" 
                                   max="${param.max || ''}"
                                   step="${param.step || ''}">
                        </div>
                    `;
                case 'select':
                    return `
                        <div class="node-param">
                            <div class="param-label">${param.label}</div>
                            <select class="param-select" name="${param.name}">
                                ${param.options.map(option => `
                                    <option value="${option}" ${option === param.default ? 'selected' : ''}>${option}</option>
                                `).join('')}
                            </select>
                        </div>
                    `;
                default:
                    return '';
            }
        }).join('');
    }

    // 获取默认参数
    getDefaultParams(params) {
        const defaultParams = {};
        if (params) {
            params.forEach(param => {
                defaultParams[param.name] = param.default || '';
            });
        }
        return defaultParams;
    }

    // 绑定节点事件
    bindNodeEvents(nodeElement, nodeId) {
        // 选择节点
        nodeElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectNode(nodeId);
        });

        // 拖拽节点
        nodeElement.addEventListener('mousedown', (e) => {
            if (e.target.closest('.node-menu')) return;
            
            this.draggedNode = nodeId;
            const rect = nodeElement.getBoundingClientRect();
            this.dragOffset = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
            
            nodeElement.classList.add('dragging');
            document.addEventListener('mousemove', this.handleNodeDrag);
            document.addEventListener('mouseup', this.handleNodeDragEnd);
        });

        // 参数变化
        const inputs = nodeElement.querySelectorAll('.param-input, .param-textarea, .param-select');
        inputs.forEach(input => {
            input.addEventListener('change', () => {
                this.updateNodeParams(nodeId);
            });
        });

        // 连接点事件
        const connectionPoints = nodeElement.querySelectorAll('.connection-point');
        connectionPoints.forEach(point => {
            point.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.startConnection(nodeId, point.classList.contains('output'));
            });
        });
    }

    // 拖拽节点处理
    handleNodeDrag = (e) => {
        if (!this.draggedNode) return;

        const node = this.nodes.get(this.draggedNode);
        if (!node) return;

        const canvasRect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - canvasRect.left - this.dragOffset.x - this.pan.x) / this.zoom;
        const y = (e.clientY - canvasRect.top - this.dragOffset.y - this.pan.y) / this.zoom;

        node.x = x;
        node.y = y;
        node.element.style.left = `${x}px`;
        node.element.style.top = `${y}px`;

        this.updateConnections();
    };

    // 结束拖拽
    handleNodeDragEnd = () => {
        if (this.draggedNode) {
            const node = this.nodes.get(this.draggedNode);
            if (node) {
                node.element.classList.remove('dragging');
            }
            this.draggedNode = null;
        }
        
        document.removeEventListener('mousemove', this.handleNodeDrag);
        document.removeEventListener('mouseup', this.handleNodeDragEnd);
    };

    // 选择节点
    selectNode(nodeId) {
        this.deselectAll();
        this.selectedNode = nodeId;
        
        const node = this.nodes.get(nodeId);
        if (node) {
            node.element.classList.add('selected');
            this.updatePropertyPanel(node);
        }
    }

    // 取消选择
    deselectAll() {
        if (this.selectedNode) {
            const node = this.nodes.get(this.selectedNode);
            if (node) {
                node.element.classList.remove('selected');
            }
            this.selectedNode = null;
        }

        if (this.selectedConnection) {
            const connection = this.connections.get(this.selectedConnection);
            if (connection) {
                connection.element.classList.remove('selected');
            }
            this.selectedConnection = null;
        }

        this.updatePropertyPanel();
    }

    // 删除节点
    deleteNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) return;

        // 删除相关连接
        const connectionsToDelete = [];
        this.connections.forEach((connection, id) => {
            if (connection.from === nodeId || connection.to === nodeId) {
                connectionsToDelete.push(id);
            }
        });

        connectionsToDelete.forEach(id => {
            this.deleteConnection(id);
        });

        // 删除节点元素
        node.element.remove();
        this.nodes.delete(nodeId);

        if (this.selectedNode === nodeId) {
            this.selectedNode = null;
            this.updatePropertyPanel();
        }
    }

    // 更新节点参数
    updateNodeParams(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node) return;

        const inputs = node.element.querySelectorAll('.param-input, .param-textarea, .param-select');
        inputs.forEach(input => {
            node.params[input.name] = input.value;
        });
    }

    // 更新属性面板
    updatePropertyPanel(node = null) {
        const propertyContent = document.querySelector('.property-content');
        if (!propertyContent) return;

        if (!node) {
            propertyContent.innerHTML = `
                <div style="text-align: center; color: #a0aec0; margin-top: 60px;">
                    <i class="fas fa-mouse-pointer" style="font-size: 48px; margin-bottom: 16px;"></i>
                    <p>选择一个节点查看属性</p>
                </div>
            `;
            return;
        }

        const toolInfo = this.getToolInfo(node.type);
        propertyContent.innerHTML = `
            <div class="property-section">
                <div class="section-title">基本信息</div>
                <div class="property-item">
                    <label class="property-label">节点名称</label>
                    <input type="text" class="property-input" value="${toolInfo.name}" readonly>
                </div>
                <div class="property-item">
                    <label class="property-label">节点ID</label>
                    <input type="text" class="property-input" value="${node.id}" readonly>
                </div>
            </div>
            
            <div class="property-section">
                <div class="section-title">参数配置</div>
                ${this.renderPropertyParams(toolInfo.params, node.params)}
            </div>
        `;

        // 绑定属性面板事件
        this.bindPropertyEvents(node.id);
    }

    // 渲染属性参数
    renderPropertyParams(params, values) {
        if (!params || params.length === 0) {
            return '<p style="color: #a0aec0; font-size: 14px;">该节点无可配置参数</p>';
        }

        return params.map(param => {
            const value = values[param.name] || param.default || '';
            
            switch (param.type) {
                case 'text':
                    return `
                        <div class="property-item">
                            <label class="property-label">${param.label}</label>
                            <input type="text" class="property-input" name="${param.name}" value="${value}">
                        </div>
                    `;
                case 'textarea':
                    return `
                        <div class="property-item">
                            <label class="property-label">${param.label}</label>
                            <textarea class="property-textarea" name="${param.name}">${value}</textarea>
                        </div>
                    `;
                case 'number':
                    return `
                        <div class="property-item">
                            <label class="property-label">${param.label}</label>
                            <input type="number" class="property-input" name="${param.name}" 
                                   value="${value}"
                                   min="${param.min || ''}" 
                                   max="${param.max || ''}"
                                   step="${param.step || ''}">
                        </div>
                    `;
                case 'select':
                    return `
                        <div class="property-item">
                            <label class="property-label">${param.label}</label>
                            <select class="property-select" name="${param.name}">
                                ${param.options.map(option => `
                                    <option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>
                                `).join('')}
                            </select>
                        </div>
                    `;
                default:
                    return '';
            }
        }).join('');
    }

    // 绑定属性面板事件
    bindPropertyEvents(nodeId) {
        const inputs = document.querySelectorAll('.property-input, .property-textarea, .property-select');
        inputs.forEach(input => {
            input.addEventListener('change', () => {
                this.updateNodeParamsFromProperty(nodeId, input.name, input.value);
            });
        });
    }

    // 从属性面板更新节点参数
    updateNodeParamsFromProperty(nodeId, paramName, value) {
        const node = this.nodes.get(nodeId);
        if (!node) return;

        node.params[paramName] = value;

        // 同步更新节点内的参数输入框
        const nodeInput = node.element.querySelector(`[name="${paramName}"]`);
        if (nodeInput) {
            nodeInput.value = value;
        }
    }

    // 设置缩放
    setZoom(zoom) {
        this.zoom = Math.max(0.1, Math.min(3, zoom));
        this.canvasContent.style.transform = `scale(${this.zoom}) translate(${this.pan.x}px, ${this.pan.y}px)`;
        
        const zoomLevel = document.querySelector('.zoom-level');
        if (zoomLevel) {
            zoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    // 开始连接
    startConnection(nodeId, isOutput) {
        this.connecting = true;
        this.connectionStart = { nodeId, isOutput };
        
        // 添加临时连接线跟随鼠标
        document.addEventListener('mousemove', this.handleConnectionDrag);
        document.addEventListener('mouseup', this.handleConnectionEnd);
    }

    // 连接拖拽处理
    handleConnectionDrag = (e) => {
        // TODO: 实现临时连接线绘制
    };

    // 结束连接
    handleConnectionEnd = (e) => {
        this.connecting = false;
        document.removeEventListener('mousemove', this.handleConnectionDrag);
        document.removeEventListener('mouseup', this.handleConnectionEnd);
        
        // TODO: 检查是否连接到有效的目标节点
    };

    // 更新连接线
    updateConnections() {
        // TODO: 重新计算和绘制所有连接线
    }

    // 加载工作流
    async loadWorkflow() {
        // TODO: 从后端加载工作流数据
        Utils.showToast('工作流加载功能开发中', 'info');
    }

    // 保存工作流
    async saveWorkflow() {
        const workflowData = {
            nodes: Array.from(this.nodes.values()).map(node => ({
                id: node.id,
                type: node.type,
                x: node.x,
                y: node.y,
                params: node.params
            })),
            connections: Array.from(this.connections.values())
        };

        try {
            Utils.showLoading();
            
            // TODO: 发送到后端保存
            console.log('保存工作流:', workflowData);
            
            Utils.showToast('工作流保存成功', 'success');
        } catch (error) {
            Utils.showToast('保存失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 运行工作流
    async runWorkflow() {
        if (this.nodes.size === 0) {
            Utils.showToast('请先添加节点', 'warning');
            return;
        }

        try {
            Utils.showLoading();
            
            // TODO: 执行工作流
            console.log('运行工作流');
            
            Utils.showToast('工作流执行完成', 'success');
        } catch (error) {
            Utils.showToast('执行失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.orchestrator = new Orchestrator();
});

// 导出Orchestrator类
window.Orchestrator = Orchestrator;