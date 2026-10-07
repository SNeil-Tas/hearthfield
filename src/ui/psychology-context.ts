import { DAY_TICKS, WORK } from '../sim/definitions';
import {
  EMOTIONAL_NEEDS,
  memoryEffect,
  NEED_HELP,
  NEED_LABELS,
  needImportance,
  psychologicalMood,
  TRAITS,
} from '../sim/psychology';
import { COPING_LABELS } from '../sim/psychology-care';
import type { Pawn, PersonalityTrait, World } from '../sim/types';
import { escapeHTML as esc } from './icons';

const TRAIT_LABELS: Record<PersonalityTrait, [string, string, string]> = {
  sociability: ['Reserved', 'Companionable', 'Outgoing'],
  resilience: ['Easily unsettled', 'Adaptable', 'Resilient'],
  diligence: ['Easygoing', 'Practical', 'Driven'],
  curiosity: ['Routine-loving', 'Open-minded', 'Curious'],
  sensitivity: ['Unfussy', 'Attentive', 'Sensitive'],
  empathy: ['Blunt', 'Considerate', 'Empathetic'],
};
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;

export function psychologyContextHTML(w: World, pawn: Pawn) {
  const p = pawn.psychology;
  const state = p.overwhelmed
    ? 'Overwhelmed'
    : p.stress >= 45
      ? 'Under pressure'
      : p.stress >= 20
        ? 'Uneasy'
        : 'Settled';
  const strongest = [...EMOTIONAL_NEEDS].sort(
    (a, b) =>
      (45 - p.needs[b]) * needImportance(pawn, b) - (45 - p.needs[a]) * needImportance(pawn, a),
  )[0]!;
  const concern =
    p.needs[strongest] < 45
      ? `${NEED_LABELS[strongest]} is running low. ${NEED_HELP[strongest]}`
      : p.overwhelmed
        ? 'Still recovering from sustained stress. Rest and personal breaks help.'
        : 'Emotional needs are being met. Sustained strain takes time to recover from.';
  const memories = p.memories
    .filter((m) => m.expiresAt > w.tick)
    .sort((a, b) => Math.abs(memoryEffect(b, w.tick)) - Math.abs(memoryEffect(a, w.tick)))
    .slice(0, 5);
  return `<section class="psychology" aria-label="Psychological profile">
    <span class="eyebrow">INNER LIFE · ${esc(state.toUpperCase())}</span>
    <p class="psychology-summary">${esc(concern)}</p>
    <div class="psychology-stress"><span>Stress</span><meter aria-label="Stress" min="0" max="100" low="25" high="65" optimum="0" value="${p.stress}"></meter><b>${Math.round(p.stress)}</b></div>
    <p class="psychology-effect">Emotional effect on mood: ${signed(psychologicalMood(w, pawn))}${pawn.job?.copingActivity ? `<br>${COPING_LABELS[pawn.job.copingActivity]}` : ''}</p>
    <span class="eyebrow">PERSONALITY</span>
    <div class="personality-traits">${TRAITS.map((trait) => {
      const value = p.traits[trait];
      return `<div><strong>${TRAIT_LABELS[trait][value < 35 ? 0 : value > 65 ? 2 : 1]}</strong><small>${trait} ${value}/100</small></div>`;
    }).join('')}</div>
    <p>Finds purpose in ${WORK[p.preferredWork].toLowerCase()} work. ${p.traits.sociability >= 50 ? 'Regular company matters more than solitude.' : 'Needs quiet time as well as close connections.'} ${p.traits.resilience >= 50 ? 'Recovers from stress more readily.' : 'Needs longer to recover from strain.'}</p>
    <span class="eyebrow">EMOTIONAL NEEDS</span>
    <div class="emotional-needs">${EMOTIONAL_NEEDS.map((need) => `<div class="emotional-need${p.needs[need] < 35 ? ' unmet' : ''}"><div class="need"><span>${NEED_LABELS[need]}</span><meter aria-label="${NEED_LABELS[need]}" min="0" max="100" low="25" high="60" optimum="100" value="${p.needs[need]}"></meter><b>${Math.round(p.needs[need])}</b></div><small>${NEED_HELP[need]}</small></div>`).join('')}</div>
    <span class="eyebrow">RECENT MEMORIES</span>
    ${memories.length ? `<ul class="memory-list">${memories.map((m) => `<li><div><span>${esc(m.text)}</span><small>Fades over ${(Math.max(0, m.expiresAt - w.tick) / DAY_TICKS).toFixed(1)} days</small></div><b class="${m.impact < 0 ? 'negative' : 'positive'}">${signed(memoryEffect(m, w.tick))}</b></li>`).join('')}</ul>` : '<p>No lasting experiences yet.</p>'}
    </section>`;
}
