/**
 * 解析给定的值字符串，并将其转换为适当的JavaScript数据类型。
 * @param valStr - 从正则表达式匹配中提取的原始值字符串。
 * @returns - 解析后的值。
 */
function parseLiquidValue(valStr: string): string | number | boolean | null | undefined {
    if (valStr === undefined || valStr === null) {
        return undefined;
    }
    const trimmedVal = valStr.trim();

    // 检查布尔值和null
    if (trimmedVal === 'true') return true;
    if (trimmedVal === 'false') return false;
    if (trimmedVal === 'nil' || trimmedVal === 'null') return null;

    // 检查是否是被引号包裹的字符串
    if ((trimmedVal.startsWith("'") && trimmedVal.endsWith("'")) || (trimmedVal.startsWith('"') && trimmedVal.endsWith('"'))) {
        return trimmedVal.slice(1, -1);
    }
    
    // 检查是否是数字
    if (!isNaN(Number(trimmedVal)) && trimmedVal !== '') {
        return Number(trimmedVal);
    }

    // 默认作为字符串返回（适用于未加引号的字符串，如 case...when my_string）
    return trimmedVal;
}


/**
 * 从Liquid模版中找出指定变量的所有可能取值。
 *
 * @param {string[]} variableNames - 需要查找的变量名称数组。
 * @param {string} liquidTemplate - Liquid模版内容的字符串。
 * @returns {Object.<string, Array<string|number|boolean|null>>} - 一个对象，键是变量名，值是该变量所有可能取值的数组。
 */
export function findLiquidVariableValues(variableNames: string[], liquidTemplate: string): Record<string, Array<string | number | boolean | null>> {
    const results: Record<string, Set<string | number | boolean | null>> = {};
    // 为每个变量初始化一个Set，用于自动去重
    variableNames.forEach(name => {
        results[name] = new Set();
    });

    // 模式1: 匹配标准的比较操作 (e.g., var == 'value', var contains 123)
    // 支持 'string', "string", number, true, false, nil
    const valuePattern = `(?:'[^']*'|"[^"]*"|-?\\d+(?:\\.\\d+)?|true|false|nil|null)`;

    for (const varName of variableNames) {
        // 1. 查找直接比较和 contains
        const comparisonRegex = new RegExp(
            `\\b${varName}\\b\\s*(?:==|!=|>=|<=|>|<|contains)\\s*(${valuePattern})`,
            'g'
        );

        for (const match of liquidTemplate.matchAll(comparisonRegex)) {
            const parsedValue = parseLiquidValue(match[1]);
            if (parsedValue !== undefined) {
                results[varName].add(parsedValue);
            }
        }

        // 2. 查找纯布尔值检查 (e.g., {% if my_var %}, {% if not my_var %})
        // \b 确保是完整的单词, (?:and|or|%}) 确保后面是逻辑运算符或标签结束，避免匹配到 my_var.property
        const booleanRegex = new RegExp(
            `{%-?\\s*(?:if|unless|elsif)\\s+(?:not\\s+)?${varName}\\b\\s*(?:and|or|%})`,
            'g'
        );
        if (booleanRegex.test(liquidTemplate)) {
            results[varName].add(true);
            results[varName].add(false);
        }

        // 3. 查找 case/when 结构
        const caseRegex = new RegExp(
            `{%-?\\s*case\\s+${varName}\\s*-?%}(.*?){%-?\\s*endcase\\s*-?%}`,
            'gs' // 's' 标志让 '.' 可以匹配换行符
        );
        for (const caseMatch of liquidTemplate.matchAll(caseRegex)) {
            const caseBlock = caseMatch[1];
            // 匹配 case 块内的所有 when
            const whenRegex = new RegExp(`{%-?\\s*when\\s+(.*?)\\s*-?%}`, 'g');
            for (const whenMatch of caseBlock.matchAll(whenRegex)) {
                // 'when' 后面可能跟着 'or' 连接的多个值
                const conditions = whenMatch[1].split(/\s+or\s+/);
                conditions.forEach(condition => {
                    const parsedValue = parseLiquidValue(condition);
                    if (parsedValue !== undefined) {
                        results[varName].add(parsedValue);
                    }
                });
            }
        }
    }

    // 将最终的Set转换为数组
    const finalResults: Record<string, Array<string | number | boolean | null>> = {};
    for (const name in results) {
        finalResults[name] = Array.from(results[name]);
    }

    return finalResults;
}