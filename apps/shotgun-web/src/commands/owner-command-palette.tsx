import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';

import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { useProductLocalization } from '../localization/product-localization.js';
import {
  filterOwnerCommands,
  type OwnerCommandCategory,
  type OwnerCommandDefinition,
} from './owner-command-registry.js';

export type OwnerCommandPaletteProps = {
  readonly open: boolean;
  readonly commands: readonly OwnerCommandDefinition[];
  readonly initialQuery?: string;
  readonly resetQuerySignal?: number;
  readonly presentation?: 'DIALOG' | 'CENTER';
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
  readonly onSelect: (command: OwnerCommandDefinition) => void;
};

const koCommandLabels: Readonly<
  Record<string, { readonly label: string; readonly alias: string }>
> = {
  'help.commands': { label: '명령 보기', alias: '명령' },
  'search.global': { label: '전체 검색', alias: '검색' },
  'project.manage': { label: '프로젝트 관리', alias: '프로젝트 관리' },
  'project.create': { label: '프로젝트 만들기', alias: '프로젝트 생성' },
  'project.rename': { label: '프로젝트 이름 바꾸기', alias: '프로젝트 이름 변경' },
  'project.archive': { label: '프로젝트 보관', alias: '프로젝트 보관' },
  'project.restore': { label: '프로젝트 복원', alias: '프로젝트 복원' },
  'project.delete_request': { label: '프로젝트 삭제 요청', alias: '프로젝트 삭제' },
  'preferences.locale': { label: '언어 설정', alias: '언어' },
  'preferences.timezone': { label: '시간대 설정', alias: '시간대' },
  'preferences.display': { label: '화면 환경설정', alias: '화면 설정' },
  'ai.configure': { label: 'AI 구성', alias: 'AI 설정' },
  'ai.test_connection': { label: 'AI 연결 테스트', alias: 'AI 연결' },
  'privacy.open': { label: '개인정보 설정 열기', alias: '개인정보' },
  'privacy.review': { label: '개인정보 검토', alias: '개인정보 검토' },
  'knowledge.open': { label: '지식 열기', alias: '지식' },
  'review.open': { label: '검토 열기', alias: '검토' },
  'external_action.open': { label: '외부 작업 열기', alias: '외부 작업' },
  'activity.open': { label: '활동 열기', alias: '활동' },
  'history.open': { label: '이력 열기', alias: '이력' },
  'technical.current': { label: '기술 정보', alias: '기술 정보' },
  'answer.export': { label: '답변 내보내기', alias: '답변 내보내기' },
  'action.retry': { label: '답변 다시 시도', alias: '답변 재시도' },
  'answer.propose_intake': { label: '접수 초안 제안', alias: '답변 접수' },
  'answer.propose_change': { label: '변경 초안 제안', alias: '답변 변경' },
  'answer.propose_directive': { label: '지시사항 제안', alias: '답변 지시사항' },
};

export const OwnerCommandPalette = ({
  open,
  commands,
  initialQuery = '',
  resetQuerySignal = 0,
  presentation = 'DIALOG',
  invoker,
  onClose,
  onSelect,
}: OwnerCommandPaletteProps) => {
  const { locale, t } = useProductLocalization();
  const dialog = useAccessibleDialog({
    open,
    onClose,
    trapFocus: presentation === 'DIALOG',
  });
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const localizedCommands = useMemo(
    () =>
      locale === 'ko-KR'
        ? commands.map((command) => {
            const localized = koCommandLabels[command.id];
            return localized
              ? {
                  ...command,
                  label: localized.label,
                  description: `${localized.label} 명령을 엽니다.`,
                  aliases: [...command.aliases, localized.alias],
                }
              : command;
          })
        : commands,
    [commands, locale],
  );
  const filteredCommands = useMemo(
    () => filterOwnerCommands(localizedCommands, query),
    [localizedCommands, query],
  );
  const commandGroups = useMemo(() => {
    const categories: readonly OwnerCommandCategory[] = [
      'HELP',
      'SEARCH',
      'PROJECT',
      'ANSWER',
      'AI',
      'PRIVACY',
      'PREFERENCES',
      'NAVIGATION',
      'INSPECTION',
    ];
    const categoryLabels: Record<OwnerCommandCategory, string> = {
      HELP: t('commands.category.help'),
      SEARCH: t('commands.category.search'),
      PROJECT: t('commands.category.project'),
      ANSWER: t('commands.category.answer'),
      AI: t('commands.category.ai'),
      PRIVACY: t('commands.category.privacy'),
      PREFERENCES: t('commands.category.preferences'),
      NAVIGATION: t('commands.category.navigation'),
      INSPECTION: t('commands.category.inspection'),
    };

    return categories
      .map((category) => ({
        category,
        label: categoryLabels[category],
        commands: filteredCommands
          .map((command, index) => ({ command, index }))
          .filter(({ command }) => command.category === category),
      }))
      .filter((group) => group.commands.length > 0);
  }, [filteredCommands, t]);

  useEffect(() => {
    if (!open) return;
    dialog.captureInvoker(invoker);
    setQuery(initialQuery);
    setSelectedIndex(0);
  }, [initialQuery, invoker, open, resetQuerySignal]);

  useEffect(() => {
    setSelectedIndex((current) =>
      filteredCommands.length === 0 ? 0 : Math.min(current, filteredCommands.length - 1),
    );
  }, [filteredCommands.length]);

  if (!open) return null;

  const commandDomId = (command: OwnerCommandDefinition, index: number) =>
    `${listId}-${command.id}-${command.context?.projectId ?? index}`;

  const selectCommand = (command: OwnerCommandDefinition) => {
    if (command.availability !== 'AVAILABLE') return;
    onSelect(command);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    dialog.onDialogKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredCommands.length === 0 ? 0 : (current + 1) % filteredCommands.length,
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredCommands.length === 0
          ? 0
          : (current - 1 + filteredCommands.length) % filteredCommands.length,
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSelectedIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSelectedIndex(Math.max(filteredCommands.length - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) selectCommand(selected);
    }
  };

  const isDialog = presentation === 'DIALOG';

  return (
    <div
      className={isDialog ? 'modal-backdrop' : 'center-command-mode'}
      {...(isDialog ? { role: 'dialog', 'aria-modal': true } : { role: 'region' })}
      aria-labelledby={titleId}
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div
        className={
          isDialog
            ? 'modal-card owner-command-palette hfm-command-surface'
            : 'owner-command-palette hfm-command-surface center-command-mode__surface'
        }
      >
        <h2 id={titleId}>{t('commands.title')}</h2>
        <p>{t('commands.help')}</p>
        <label htmlFor={`${listId}-query`}>{t('commands.search_label')}</label>
        <input
          id={`${listId}-query`}
          value={query}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedIndex(0);
          }}
          aria-controls={listId}
          aria-activedescendant={
            filteredCommands[selectedIndex]
              ? commandDomId(filteredCommands[selectedIndex], selectedIndex)
              : undefined
          }
        />
        <div id={listId} className="command-list owner-command-list" role="listbox">
          {filteredCommands.length === 0 ? (
            <p className="owner-command-empty" role="status">
              {t('commands.no_match')}
            </p>
          ) : (
            commandGroups.map((group) => (
              <section
                key={group.category}
                className="owner-command-group"
                aria-labelledby={`${listId}-${group.category}`}
              >
                <h3 id={`${listId}-${group.category}`}>{group.label}</h3>
                <ul className="owner-command-group-list">
                  {group.commands.map(({ command, index }) => {
                    const unavailable = command.availability !== 'AVAILABLE';
                    return (
                      <li
                        key={commandDomId(command, index)}
                        id={commandDomId(command, index)}
                        role="option"
                        aria-selected={index === selectedIndex}
                      >
                        <button
                          type="button"
                          className={`hfm-action-selection${index === selectedIndex ? ' owner-command-option-selected' : ''}`}
                          disabled={unavailable}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onClick={() => selectCommand(command)}
                        >
                          <span>
                            <strong>{command.label}</strong>
                            <small>{command.description}</small>
                          </span>
                          {unavailable && (command.reasonKey || command.reason) ? (
                            <small>
                              {command.reasonKey ? t(command.reasonKey) : command.reason}
                            </small>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="dialog-actions">
          <span className="owner-command-hint">{t('commands.keyboard_hint')}</span>
          <button className="hfm-action-secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
