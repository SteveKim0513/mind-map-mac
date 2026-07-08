import { useState } from 'react';
import type { MetaTemplate, NoteMetaBlock, MetaFieldDef } from '../types';
import { Icon } from '../ui/Icon';

interface Props {
  blocks: NoteMetaBlock[];
  templates: MetaTemplate[];
  onChange: (blocks: NoteMetaBlock[]) => void;
}

export function NoteMetaBlocks({ blocks, templates, onChange }: Props) {
  if (blocks.length === 0) return null;
  return (
    <div className="note-meta-blocks">
      {blocks.map((block, i) => (
        <MetaBlockItem
          key={`${block.templateId}-${i}`}
          block={block}
          templates={templates}
          onUpdate={(updated) => {
            const next = blocks.map((b, j) => (j === i ? updated : b));
            onChange(next);
          }}
          onRemove={() => onChange(blocks.filter((_, j) => j !== i))}
        />
      ))}
    </div>
  );
}

function MetaBlockItem({
  block, templates, onUpdate, onRemove,
}: {
  block: NoteMetaBlock;
  templates: MetaTemplate[];
  onUpdate: (b: NoteMetaBlock) => void;
  onRemove: () => void;
}) {
  const template = templates.find((t) => t.id === block.templateId);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (field: MetaFieldDef) => {
    setEditingKey(field.key);
    setDraft(block.values[field.key] ?? '');
  };

  const commitEdit = (key: string) => {
    onUpdate({ ...block, values: { ...block.values, [key]: draft } });
    setEditingKey(null);
  };

  const cancelEdit = () => setEditingKey(null);

  if (!template) {
    return (
      <div className="meta-block meta-block--deleted">
        <span className="meta-block-title meta-block-title--warn">⚠ 삭제된 템플릿</span>
        <button className="meta-block-close" title="제거" onClick={onRemove}>
          <Icon name="close" />
        </button>
      </div>
    );
  }

  return (
    <div className="meta-block">
      <div className="meta-block-head">
        <span className="meta-block-title">{template.name}</span>
        <button className="meta-block-close" title="메타 제거" onClick={onRemove}>
          <Icon name="close" />
        </button>
      </div>
      <table className="meta-table">
        <tbody>
          {template.fields.map((field) => {
            const value = block.values[field.key] ?? '';
            const isEditing = editingKey === field.key;

            return (
              <tr key={field.key} className="meta-row">
                <td className="meta-label">{field.label}</td>
                <td className="meta-value">
                  {isEditing ? (
                    <FieldEditor
                      field={field}
                      value={draft}
                      onChange={setDraft}
                      onCommit={() => commitEdit(field.key)}
                      onCancel={cancelEdit}
                      onTabNext={() => {
                        commitEdit(field.key);
                        const idx = template.fields.findIndex((f) => f.key === field.key);
                        const next = template.fields[idx + 1];
                        if (next) setTimeout(() => startEdit(next), 0);
                      }}
                    />
                  ) : (
                    <FieldDisplay
                      field={field}
                      value={value}
                      onClick={() => startEdit(field)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldDisplay({ field, value, onClick }: { field: MetaFieldDef; value: string; onClick: () => void }) {
  const empty = !value;
  if (field.type === 'url' && value) {
    return (
      <span className="meta-val-wrap">
        <a
          className="meta-url"
          href={value}
          onClick={(e) => { e.preventDefault(); void window.api.shell.openExternal(value); }}
          title={value}
        >
          {value.replace(/^https?:\/\//, '').slice(0, 40)}
        </a>
        <button className="meta-edit-btn" onClick={onClick} title="편집">✎</button>
      </span>
    );
  }
  return (
    <span
      className={`meta-val${empty ? ' meta-val--empty' : ''}`}
      onClick={onClick}
      title="클릭해서 편집"
    >
      {empty ? '입력하세요…' : value}
    </span>
  );
}

function FieldEditor({
  field, value, onChange, onCommit, onCancel, onTabNext,
}: {
  field: MetaFieldDef;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onTabNext: () => void;
}) {
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Tab') { e.preventDefault(); onTabNext(); }
  };

  if (field.type === 'select') {
    return (
      <select
        autoFocus
        className="meta-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={handleKey}
      >
        <option value="">선택하세요</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      className="meta-input"
      type={field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={handleKey}
      placeholder={field.type === 'date' ? '' : '입력하세요…'}
    />
  );
}
