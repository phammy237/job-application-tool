'use client';

import { answerQuestion } from '@career-os/shared';
import { AskView } from '../../(app)/my/ask/ask-view';
import { SAMPLE_GRAPH } from './sample-graph';

/** Ask My over the fictional sample graph, answered in the browser (no server action, no DB). */
export function PreviewAsk() {
  return (
    <AskView
      ask={async (question) => ({
        ok: true,
        answer: answerQuestion(SAMPLE_GRAPH, question, new Date()),
      })}
    />
  );
}
