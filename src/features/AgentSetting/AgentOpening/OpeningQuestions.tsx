'use client';

import { ActionIcon, Button, Empty, Flexbox, SortableList, TextArea } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageCircle, PlusIcon, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useMergeState from 'use-merge-value';

import { useStore } from '../store';
import { selectors } from '../store/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    margin-block: 24px;
    margin-inline: auto;
  `,
  questionItemContainer: css`
    padding-block: 8px;
    padding-inline-end: 8px;
  `,
  questionItemContent: css`
    flex: 1;
    min-width: 0;
    word-break: break-word;
    white-space: pre-wrap;
  `,
  questionsList: css`
    width: 100%;
    margin-block-start: 16px;
  `,
  repeatError: css`
    margin: 0;
    color: ${cssVar.colorErrorText};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    width: 100%;
  `,
}));

interface QuestionItem {
  content: string;
  id: string | number;
}

export interface OpeningQuestionsControlProps {
  disabled?: boolean;
  onChange: (questions: string[]) => void;
  value?: string[];
}

/**
 * Presentational list editor (no AgentSetting store).
 * Used on agent profile and wrapped by settings form.
 */
export const OpeningQuestionsControl = memo<OpeningQuestionsControlProps>(
  ({ disabled = false, value, onChange }) => {
    const { t } = useTranslation('setting');
    const [questionInput, setQuestionInput] = useState('');

    // Optimistic update to avoid jitter
    const [questions, setQuestions] = useMergeState(value ?? [], {
      onChange: (next: string[]) => {
        if (disabled) return;
        onChange(next);
      },
      value: value ?? [],
    });

    const items: QuestionItem[] = useMemo(() => {
      return questions.map((item, index) => ({
        content: item,
        id: item || index,
      }));
    }, [questions]);

    const addQuestion = useCallback(() => {
      if (disabled) return;
      if (!questionInput.trim()) return;

      setQuestions([...questions, questionInput.trim()]);
      setQuestionInput('');
    }, [disabled, questionInput, questions, setQuestions]);

    const removeQuestion = useCallback(
      (content: string) => {
        if (disabled) return;

        const newQuestions = [...questions];
        const index = newQuestions.indexOf(content);
        newQuestions.splice(index, 1);
        setQuestions(newQuestions);
      },
      [disabled, questions, setQuestions],
    );

    // Handle logic after drag-and-drop sorting
    const handleSortEnd = useCallback(
      (nextItems: QuestionItem[]) => {
        if (disabled) return;

        setQuestions(nextItems.map((item) => item.content));
      },
      [disabled, setQuestions],
    );

    const isRepeat = questions.includes(questionInput.trim());

    return (
      <Flexbox gap={8} width={'100%'}>
        <Flexbox gap={4} width={'100%'}>
          <div className={styles.row}>
            <TextArea
              disabled={disabled}
              placeholder={t('settingOpening.openingQuestions.placeholder')}
              rows={3}
              style={{ flex: 1 }}
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              onPressEnter={(e) => {
                // Cmd/Ctrl+Enter adds; plain Enter keeps newline for multi-line prompts
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  addQuestion();
                }
              }}
            />
            <Button
              // don't allow repeat
              disabled={disabled || !questionInput.trim() || isRepeat}
              icon={PlusIcon}
              onClick={addQuestion}
            />
          </div>

          {isRepeat && (
            <p className={styles.repeatError}>{t('settingOpening.openingQuestions.repeat')}</p>
          )}
        </Flexbox>

        <div className={styles.questionsList}>
          {questions.length > 0 ? (
            <SortableList
              items={items}
              renderItem={(item: QuestionItem) => (
                <SortableList.Item
                  className={styles.questionItemContainer}
                  id={item.id}
                  variant={'filled'}
                >
                  {!disabled && <SortableList.DragHandle />}
                  <div className={styles.questionItemContent}>{item.content}</div>
                  <ActionIcon
                    disabled={disabled}
                    icon={Trash}
                    size={'small'}
                    onClick={() => removeQuestion(item.content)}
                  />
                </SortableList.Item>
              )}
              onChange={handleSortEnd}
            />
          ) : (
            <Empty
              className={styles.empty}
              description={t('settingOpening.openingQuestions.empty')}
              descriptionProps={{ fontSize: 14 }}
              icon={MessageCircle}
              style={{ maxWidth: 400 }}
            />
          )}
        </div>
      </Flexbox>
    );
  },
);

/** Agent settings form: reads/writes AgentSetting store. */
const OpeningQuestions = memo(() => {
  const openingQuestions = useStore(selectors.openingQuestions);
  const [disabled, updateConfig] = useStore((s) => [s.disabled, s.setAgentConfig]);

  return (
    <OpeningQuestionsControl
      disabled={disabled}
      value={openingQuestions}
      onChange={(next) => {
        if (disabled) return;
        updateConfig({ openingQuestions: next });
      }}
    />
  );
});

export default OpeningQuestions;
