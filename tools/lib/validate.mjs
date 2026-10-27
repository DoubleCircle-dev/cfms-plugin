// 扩展包校验规则：与 cfms_client_tauri custom 分支
// crates/service/src/extensions.rs 的 validate_* 保持同步；额外提供更严格的
// 声明式文档检查，用来在打包前发现问题。
import { compareSemver, parseSemver, TARGET_CLIENT } from './client.mjs';
import { isPlainObject } from './util.mjs';

export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 256;
export const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_PREFS_BYTES = 64 * 1024;
export const MIN_INTERVAL_MINUTES = 15;

export const HOST_API_VERSION = TARGET_CLIENT.hostApi;

export const ALLOWED_CAPABILITIES = Object.freeze([
  'files.metadata.read',
  'files.list',
  'files.search',
  'tasks.read',
  'transfers.download.enqueue',
  'account.summary.read',
  'preferences.read',
  'preferences.write',
  'events.subscribe',
  'ui.confirm',
  'ui.notify',
]);

export const PLATFORMS = Object.freeze(['windows', 'linux', 'macos', 'android']);
export const EVENT_TRIGGERS = Object.freeze(['connection.changed', 'tasks.changed']);
export const PAGE_BLOCK_TYPES = Object.freeze([
  'text',
  'status_card',
  'alert',
  'progress',
  'list',
  'table',
  'empty_state',
  'form',
  'actions',
]);
export const WORKFLOW_NODE_TYPES = Object.freeze([
  'host_call',
  'transform',
  'condition',
  'confirm',
  'notify',
  'navigate',
  'delay',
  'result',
]);
export const EXPRESSION_OPERATORS = Object.freeze([
  'value',
  'eq',
  'neq',
  'and',
  'or',
  'not',
  'gt',
  'gte',
  'lt',
  'lte',
  'concat',
  'length',
]);

const MANIFEST_KEYS = new Set([
  'schema_version',
  'id',
  'name',
  'description',
  'publisher',
  'version',
  'host_api',
  'min_client_version',
  'platforms',
  'entrypoints',
  'requested_capabilities',
  'background_triggers',
  'content_hashes',
]);

const ENTRY_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
const RESULT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const EXTENSION_ID_PART = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidExtensionId(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 3 || value.length > 128 || !value.includes('.')) return false;
  return value.split('.').every((part) => part.length <= 63 && EXTENSION_ID_PART.test(part));
}

/** 客户端 installer 接受的包内路径白名单（META-INF 由打包器生成）。 */
export function isAllowedPackagePath(path) {
  if (path === 'manifest.json') return true;
  if (path === 'META-INF/files.json' || path === 'META-INF/signature.ed25519') return true;
  if ((path.startsWith('pages/') || path.startsWith('workflows/') || path.startsWith('i18n/'))
    && path.endsWith('.json')) return true;
  if (path.startsWith('assets/')) {
    return /\.(png|jpe?g|webp|gif|ico)$/i.test(path);
  }
  return false;
}

/** 插件源码目录允许的文件（不允许源码内放 META-INF）。 */
export function isAllowedSourcePath(path) {
  if (path === 'manifest.json') return true;
  if ((path.startsWith('pages/') || path.startsWith('workflows/') || path.startsWith('i18n/'))
    && path.endsWith('.json')) return true;
  if (path.startsWith('assets/')) return /\.(png|jpe?g|webp|gif|ico)$/i.test(path);
  return false;
}

export function maxBytesForPath(path) {
  return path.endsWith('.json') ? MAX_JSON_BYTES : MAX_FILE_BYTES;
}

/**
 * 校验 manifest。返回 { errors, warnings }。
 * @param {unknown} manifest
 * @param {{ clientVersion?: string, targetPlatform?: string }} [options]
 */
export function validateManifest(manifest, options = {}) {
  const errors = [];
  const warnings = [];
  const clientVersion = options.clientVersion ?? TARGET_CLIENT.version;
  const targetPlatform = options.targetPlatform ?? 'windows';
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  if (!isPlainObject(manifest)) {
    return { errors: ['manifest.json 必须是 JSON 对象'], warnings };
  }

  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) warnings.push(`manifest 含未知字段 "${key}"（客户端会忽略）`);
  }

  check(manifest.schema_version === 1, `schema_version 必须是 1，当前为 ${JSON.stringify(manifest.schema_version)}`);

  if (!isValidExtensionId(manifest.id)) {
    errors.push('id 必须是反向域名标识符（如 com.example.my-plugin）：总长 3..128，至少含一个 "."，每段 1..63 个字符，仅小写字母/数字/"-"，且不以 "-" 开头或结尾');
  }

  check(typeof manifest.name === 'string' && manifest.name.trim() !== '', 'name 必填且不能为空白字符串');
  check(typeof manifest.publisher === 'string' && manifest.publisher.trim() !== '', 'publisher 必填且不能为空白字符串');
  check(typeof manifest.description === 'string', 'description 必填（字符串，可为空串）');

  if (!parseSemver(manifest.version)) {
    errors.push(`version 必须是 semver（如 1.0.0 / 1.2.0-beta.1），当前为 ${JSON.stringify(manifest.version)}`);
  }

  if (typeof manifest.host_api !== 'string' || !manifest.host_api.startsWith('1')) {
    errors.push(`host_api 必须以 "1" 开头（当前客户端 HOST_API_VERSION=${HOST_API_VERSION}），当前为 ${JSON.stringify(manifest.host_api)}`);
  }

  if (!parseSemver(manifest.min_client_version)) {
    errors.push(`min_client_version 必须是 semver，当前为 ${JSON.stringify(manifest.min_client_version)}`);
  } else {
    try {
      if (compareSemver(manifest.min_client_version, clientVersion) > 0) {
        errors.push(`min_client_version ${manifest.min_client_version} 高于目标客户端版本 ${clientVersion}`);
      }
    } catch (cause) {
      errors.push(cause.message);
    }
  }

  if (manifest.platforms !== undefined) {
    if (!Array.isArray(manifest.platforms)) {
      errors.push('platforms 必须是字符串数组');
    } else {
      for (const platform of manifest.platforms) {
        if (typeof platform !== 'string' || platform === '') {
          errors.push('platforms 的每一项必须是非空字符串');
        } else if (!PLATFORMS.includes(platform)) {
          warnings.push(`platforms 含未知平台 "${platform}"（已知：${PLATFORMS.join(', ')}）`);
        }
      }
      if (manifest.platforms.length > 0 && !manifest.platforms.includes(targetPlatform)) {
        warnings.push(`platforms 不含目标平台 "${targetPlatform}"，安装时客户端会拒绝`);
      }
    }
  }

  const entrypoints = manifest.entrypoints;
  if (entrypoints !== undefined) {
    if (!isPlainObject(entrypoints)) {
      errors.push('entrypoints 必须是对象');
    } else {
      for (const key of Object.keys(entrypoints)) {
        if (!['navigation', 'settings', 'workflows'].includes(key)) {
          warnings.push(`entrypoints 含未知字段 "${key}"（客户端会忽略）`);
        }
      }
      validateEntrypointList(entrypoints.navigation, 'navigation', ['id', 'label', 'icon', 'page'], errors, warnings);
      validateEntrypointList(entrypoints.settings, 'settings', ['id', 'label', 'page'], errors, warnings);
      validateEntrypointList(entrypoints.workflows, 'workflows', ['id', 'label', 'workflow'], errors, warnings);
    }
  }

  if (manifest.requested_capabilities !== undefined) {
    if (!Array.isArray(manifest.requested_capabilities)) {
      errors.push('requested_capabilities 必须是字符串数组');
    } else {
      const seen = new Set();
      for (const capability of manifest.requested_capabilities) {
        if (typeof capability !== 'string' || !ALLOWED_CAPABILITIES.includes(capability)) {
          errors.push(`requested_capabilities 含不支持的能力 ${JSON.stringify(capability)}`);
        } else if (seen.has(capability)) {
          errors.push(`requested_capabilities 重复声明能力 ${capability}`);
        } else {
          seen.add(capability);
        }
      }
    }
  }

  if (manifest.background_triggers !== undefined) {
    if (!Array.isArray(manifest.background_triggers)) {
      errors.push('background_triggers 必须是数组');
    } else {
      manifest.background_triggers.forEach((trigger, index) => {
        const label = `background_triggers[${index}]`;
        if (!isPlainObject(trigger)) {
          errors.push(`${label} 必须是对象`);
          return;
        }
        if (!['on_enable', 'on_login', 'interval', 'event'].includes(trigger.type)) {
          errors.push(`${label}.type 必须是 on_enable/on_login/interval/event`);
        }
        if (typeof trigger.workflow !== 'string' || !ENTRY_ID_PATTERN.test(trigger.workflow)) {
          errors.push(`${label}.workflow 必须是合法的 entrypoint id`);
        }
        if (trigger.type === 'interval') {
          if (!Number.isInteger(trigger.minutes) || trigger.minutes < MIN_INTERVAL_MINUTES) {
            errors.push(`${label}.minutes 必须是 ≥${MIN_INTERVAL_MINUTES} 的整数`);
          }
        }
        if (trigger.type === 'event' && !EVENT_TRIGGERS.includes(trigger.event)) {
          errors.push(`${label}.event 必须是 ${EVENT_TRIGGERS.join('/')} 之一`);
        }
        for (const key of Object.keys(trigger)) {
          if (!['type', 'workflow', 'minutes', 'event'].includes(key)) {
            warnings.push(`${label} 含未知字段 "${key}"（客户端会忽略）`);
          }
        }
      });
    }
  }

  if (manifest.content_hashes !== undefined) {
    if (!isPlainObject(manifest.content_hashes)) {
      errors.push('content_hashes 必须是对象');
    } else if (Object.keys(manifest.content_hashes).length > 0) {
      warnings.push('content_hashes 当前客户端不校验，属于保留字段');
    }
  }

  return { errors, warnings };
}

function validateEntrypointList(value, name, requiredKeys, errors, warnings) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`entrypoints.${name} 必须是数组`);
    return;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    const label = `entrypoints.${name}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} 必须是对象`);
      return;
    }
    for (const key of requiredKeys) {
      if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
        errors.push(`${label}.${key} 必填且必须是非空字符串`);
      }
    }
    const idKey = name === 'workflows' ? 'workflow' : 'page';
    for (const key of ['id', idKey]) {
      if (typeof entry[key] === 'string' && !ENTRY_ID_PATTERN.test(entry[key])) {
        errors.push(`${label}.${key} 必须匹配 ^[a-z0-9_-]{1,64}$`);
      }
    }
    if (typeof entry.id === 'string') {
      if (seen.has(entry.id)) errors.push(`${label}.id "${entry.id}" 重复`);
      seen.add(entry.id);
    }
    if (name === 'navigation' && typeof entry.icon === 'string' && entry.icon === '') {
      errors.push(`${label}.icon 不能为空`);
    }
  });
}

/** 校验已解析的页面文档；返回 { errors, warnings }。 */
export function validatePageDocument(page, fileLabel) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(page)) {
    errors.push(`${fileLabel} 必须是 JSON 对象`);
    return { errors, warnings };
  }
  if (page.schema_version !== 1) errors.push(`${fileLabel}.schema_version 必须是 1`);
  if (typeof page.title !== 'string' || page.title.trim() === '') {
    errors.push(`${fileLabel}.title 必填且必须是非空字符串`);
  }
  if (page.description !== undefined && typeof page.description !== 'string') {
    errors.push(`${fileLabel}.description 必须是字符串`);
  }
  if (!Array.isArray(page.blocks)) {
    errors.push(`${fileLabel}.blocks 必须是数组`);
    return { errors, warnings };
  }
  page.blocks.forEach((block, index) => {
    const label = `${fileLabel}.blocks[${index}]`;
    if (!isPlainObject(block)) {
      errors.push(`${label} 必须是对象`);
      return;
    }
    if (!PAGE_BLOCK_TYPES.includes(block.type)) {
      warnings.push(`${label}.type "${block.type}" 不在当前渲染器支持范围内，会被跳过`);
      return;
    }
    switch (block.type) {
      case 'text':
        if (typeof block.text !== 'string') errors.push(`${label}.text 必填`);
        if (block.style !== undefined && !['body', 'caption', 'heading'].includes(block.style)) {
          warnings.push(`${label}.style "${block.style}" 无效（body/caption/heading），按 body 渲染`);
        }
        break;
      case 'status_card':
        if (typeof block.title !== 'string' || typeof block.value !== 'string') {
          errors.push(`${label} 需要字符串 title 与 value`);
        }
        if (block.tone !== undefined && !['default', 'success', 'warning', 'danger'].includes(block.tone)) {
          warnings.push(`${label}.tone 无效（default/success/warning/danger）`);
        }
        break;
      case 'alert':
        if (typeof block.message !== 'string') errors.push(`${label}.message 必填`);
        if (block.tone !== undefined && !['info', 'success', 'warning', 'danger'].includes(block.tone)) {
          warnings.push(`${label}.tone 无效（info/success/warning/danger）`);
        }
        break;
      case 'progress':
        if (typeof block.label !== 'string') errors.push(`${label}.label 必填`);
        if (typeof block.value !== 'number') errors.push(`${label}.value 必须是数字`);
        if (block.max !== undefined && typeof block.max !== 'number') errors.push(`${label}.max 必须是数字`);
        break;
      case 'list':
        if (!Array.isArray(block.items)) {
          errors.push(`${label}.items 必须是数组`);
        } else {
          block.items.forEach((item, itemIndex) => {
            if (!isPlainObject(item) || typeof item.title !== 'string') {
              errors.push(`${label}.items[${itemIndex}] 需要字符串 title`);
            }
          });
        }
        break;
      case 'table':
        if (!Array.isArray(block.columns) || block.columns.length === 0) {
          errors.push(`${label}.columns 必须是非空数组`);
        } else {
          block.columns.forEach((column, columnIndex) => {
            if (!isPlainObject(column) || typeof column.key !== 'string' || typeof column.label !== 'string') {
              errors.push(`${label}.columns[${columnIndex}] 需要字符串 key 与 label`);
            }
          });
        }
        if (!Array.isArray(block.rows)) errors.push(`${label}.rows 必须是数组`);
        break;
      case 'empty_state':
        if (typeof block.title !== 'string') errors.push(`${label}.title 必填`);
        break;
      case 'form':
        if (typeof block.id !== 'string' || block.id === '') errors.push(`${label}.id 必填`);
        if (!Array.isArray(block.fields) || block.fields.length === 0) {
          errors.push(`${label}.fields 必须是非空数组`);
        } else {
          block.fields.forEach((field, fieldIndex) => {
            const fieldLabel = `${label}.fields[${fieldIndex}]`;
            if (!isPlainObject(field) || typeof field.id !== 'string' || typeof field.label !== 'string') {
              errors.push(`${fieldLabel} 需要字符串 id 与 label`);
              return;
            }
            if (!['text', 'number', 'toggle', 'select'].includes(field.type)) {
              errors.push(`${fieldLabel}.type 必须是 text/number/toggle/select`);
            }
            if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length === 0)) {
              warnings.push(`${fieldLabel} 是 select 但缺少 options，下拉框将为空`);
            }
          });
        }
        break;
      case 'actions':
        if (!Array.isArray(block.actions) || block.actions.length === 0) {
          errors.push(`${label}.actions 必须是非空数组`);
        } else {
          block.actions.forEach((action, actionIndex) => {
            const actionLabel = `${label}.actions[${actionIndex}]`;
            if (!isPlainObject(action) || typeof action.id !== 'string'
              || typeof action.label !== 'string' || typeof action.workflow !== 'string') {
              errors.push(`${actionLabel} 需要字符串 id/label/workflow`);
              return;
            }
            if (!ENTRY_ID_PATTERN.test(action.workflow)) {
              errors.push(`${actionLabel}.workflow 必须匹配 ^[a-z0-9_-]{1,64}$`);
            }
            if (action.tone !== undefined && !['primary', 'secondary', 'danger'].includes(action.tone)) {
              warnings.push(`${actionLabel}.tone 无效（primary/secondary/danger）`);
            }
          });
        }
        break;
      default:
        break;
    }
  });
  return { errors, warnings };
}

/** 校验工作流文档；返回 { errors, warnings }。 */
export function validateWorkflowDocument(workflow, fileLabel) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(workflow)) {
    errors.push(`${fileLabel} 必须是 JSON 对象`);
    return { errors, warnings };
  }
  if (workflow.schema_version !== 1) errors.push(`${fileLabel}.schema_version 必须是 1`);
  if (typeof workflow.start !== 'string' || workflow.start === '') {
    errors.push(`${fileLabel}.start 必须是节点 id 字符串`);
  }
  if (!Array.isArray(workflow.nodes)) {
    errors.push(`${fileLabel}.nodes 必须是数组`);
    return { errors, warnings };
  }

  const ids = new Set();
  workflow.nodes.forEach((node, index) => {
    if (!isPlainObject(node)) {
      errors.push(`${fileLabel}.nodes[${index}] 必须是对象`);
      return;
    }
    if (typeof node.id !== 'string' || node.id === '') {
      errors.push(`${fileLabel}.nodes[${index}].id 必填`);
    } else if (ids.has(node.id)) {
      errors.push(`${fileLabel}.nodes 中 id "${node.id}" 重复`);
    } else {
      ids.add(node.id);
    }
    if (!WORKFLOW_NODE_TYPES.includes(node.type)) {
      errors.push(`${fileLabel}.nodes[${index}].type "${node.type}" 不受当前客户端支持（运行时会抛错）`);
    }
  });
  if (typeof workflow.start === 'string' && !ids.has(workflow.start)) {
    errors.push(`${fileLabel}.start 指向不存在的节点 "${workflow.start}"`);
  }

  const nextFields = ['next', 'if_true', 'if_false', 'if_confirmed', 'if_cancelled'];
  workflow.nodes.forEach((node, index) => {
    if (!isPlainObject(node)) return;
    const label = `${fileLabel}.nodes[${index}]`;
    for (const field of nextFields) {
      if (node[field] === undefined) continue;
      if (typeof node[field] !== 'string') {
        errors.push(`${label}.${field} 必须是节点 id 字符串`);
      } else if (!ids.has(node[field])) {
        errors.push(`${label}.${field} 指向不存在的节点 "${node[field]}"`);
      }
    }
    if (typeof node.result === 'string' && !RESULT_NAME_PATTERN.test(node.result)) {
      warnings.push(`${label}.result "${node.result}" 不匹配 ${RESULT_NAME_PATTERN}，结果会被静默丢弃`);
    }

    switch (node.type) {
      case 'host_call':
        if (typeof node.capability !== 'string') {
          errors.push(`${label}.capability 必填`);
        } else if (!ALLOWED_CAPABILITIES.includes(node.capability)) {
          errors.push(`${label}.capability "${node.capability}" 不在允许清单内`);
        }
        if (node.arguments !== undefined && !isPlainObject(node.arguments)) {
          errors.push(`${label}.arguments 必须是对象`);
        }
        break;
      case 'transform':
      case 'condition':
        if (node.expression === undefined) errors.push(`${label}.expression 必填`);
        else validateExpression(node.expression, `${label}.expression`, errors, warnings);
        break;
      case 'confirm':
        if (node.message !== undefined && typeof node.message !== 'string') {
          warnings.push(`${label}.message 建议使用字符串模板`);
        }
        break;
      case 'notify':
        if (node.message !== undefined && typeof node.message !== 'string') {
          warnings.push(`${label}.message 建议使用字符串模板`);
        }
        if (node.tone !== undefined && !['info', 'success', 'warning', 'danger', 'error'].includes(node.tone)) {
          warnings.push(`${label}.tone 无效（info/success/warning/danger/error）`);
        }
        break;
      case 'navigate':
        if (typeof node.to === 'string') {
          if (!node.to.startsWith('/home/')) {
            errors.push(`${label}.to 必须以 "/home/" 开头，当前为 ${JSON.stringify(node.to)}`);
          }
        } else if (node.to !== undefined) {
          warnings.push(`${label}.to 不是字面量字符串，无法静态检查跳转目标`);
        }
        break;
      case 'delay':
        if (typeof node.milliseconds !== 'number') {
          errors.push(`${label}.milliseconds 必须是数字`);
        } else if (node.milliseconds < 0 || node.milliseconds > 5000) {
          warnings.push(`${label}.milliseconds 会被夹到 0..5000`);
        }
        break;
      default:
        break;
    }
  });
  return { errors, warnings };
}

function validateExpression(expression, label, errors, warnings) {
  if (expression === null || typeof expression !== 'object' || Array.isArray(expression)) {
    return;
  }
  const operator = expression.op ?? 'value';
  if (typeof operator !== 'string') {
    errors.push(`${label}.op 必须是字符串`);
    return;
  }
  if (!EXPRESSION_OPERATORS.includes(operator)) {
    errors.push(`${label}.op "${operator}" 不受支持（运行时抛错）`);
  }
  if (expression.args !== undefined) {
    if (!Array.isArray(expression.args)) {
      errors.push(`${label}.args 必须是数组`);
    } else {
      expression.args.forEach((arg, index) => {
        validateExpression(arg, `${label}.args[${index}]`, errors, warnings);
      });
    }
  }
  if (operator === 'value' && expression.value === undefined) {
    warnings.push(`${label} 是 value 表达式但没有 value 字段`);
  }
}

/**
 * 校验插件源码目录（Map<path, Buffer>）。
 * @param {Map<string, Buffer>} files
 * @param {{ clientVersion?: string }} [options]
 */
export function validatePluginSource(files, options = {}) {
  const errors = [];
  const warnings = [];
  const paths = [...files.keys()].sort();

  if (paths.length > MAX_FILES) errors.push(`文件数 ${paths.length} 超过上限 ${MAX_FILES}`);
  let expanded = 0;
  for (const path of paths) {
    const data = files.get(path);
    if (!isAllowedSourcePath(path)) {
      errors.push(`不允许的源码文件：${path}（只允许 manifest.json、pages/*.json、workflows/*.json、i18n/*.json、assets/* 图片）`);
    }
    if (/[^\w./-]/.test(path)) {
      warnings.push(`文件路径含非 ASCII/特殊字符：${path}（可安装，但建议只用字母数字 . _ - /）`);
    }
    const limit = maxBytesForPath(path);
    if (data.length > limit) errors.push(`${path} 大小 ${data.length} 字节超过上限 ${limit}`);
    expanded += data.length;
  }
  if (expanded > MAX_EXPANDED_BYTES) errors.push(`解压后总大小超过上限 ${MAX_EXPANDED_BYTES} 字节`);

  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) {
    return { manifest: null, errors: [...errors, '缺少 manifest.json'], warnings };
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (cause) {
    return { manifest: null, errors: [...errors, `manifest.json 不是合法 JSON: ${cause.message}`], warnings };
  }

  const manifestResult = validateManifest(manifest, options);
  errors.push(...manifestResult.errors);
  warnings.push(...manifestResult.warnings);
  if (!isPlainObject(manifest)) return { manifest: null, errors, warnings };

  const pageDocuments = new Map();
  const workflowDocuments = new Map();
  for (const path of paths) {
    if (path.startsWith('pages/')) {
      try {
        pageDocuments.set(path, JSON.parse(files.get(path).toString('utf8')));
      } catch (cause) {
        errors.push(`${path} 不是合法 JSON: ${cause.message}`);
      }
    } else if (path.startsWith('workflows/')) {
      try {
        workflowDocuments.set(path, JSON.parse(files.get(path).toString('utf8')));
      } catch (cause) {
        errors.push(`${path} 不是合法 JSON: ${cause.message}`);
      }
    }
  }

  // 所有声明的入口文档必须存在且为 JSON 对象。
  const entrypoints = isPlainObject(manifest.entrypoints) ? manifest.entrypoints : {};
  const requiredDocs = [];
  for (const entry of asArray(entrypoints.navigation)) {
    if (isPlainObject(entry) && typeof entry.page === 'string') requiredDocs.push(`pages/${entry.page}.json`);
  }
  for (const entry of asArray(entrypoints.settings)) {
    if (isPlainObject(entry) && typeof entry.page === 'string') requiredDocs.push(`pages/${entry.page}.json`);
  }
  for (const entry of asArray(entrypoints.workflows)) {
    if (isPlainObject(entry) && typeof entry.workflow === 'string') requiredDocs.push(`workflows/${entry.workflow}.json`);
  }
  for (const trigger of asArray(manifest.background_triggers)) {
    if (isPlainObject(trigger) && typeof trigger.workflow === 'string') requiredDocs.push(`workflows/${trigger.workflow}.json`);
  }
  for (const doc of requiredDocs) {
    if (!files.has(doc)) errors.push(`入口引用的文档不存在：${doc}`);
  }

  for (const [path, document] of pageDocuments) {
    const result = validatePageDocument(document, path);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  for (const [path, document] of workflowDocuments) {
    const result = validateWorkflowDocument(document, path);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { manifest, errors, warnings };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
