/**
 * Changes the AI made that the user didn't ask for, caught before they are applied (the answer goes back to the AI
 * once, with the problem): a new object for what is a look of an existing one ("a squished sprite when stomped" made
 * a "Squished Motobug" object), and a built-in behavior removed when nothing asked to remove it (Stompable swapped
 * for a script that stomped differently).
 */
import type { Operation } from '../commands/operations';
import type { AIContext } from './context';

/** The request is about how something looks. */
const LOOK = /\b(sprites?|pictures?|looks?|drawings?|drawn|draw|poses?|animations?|animated|art|images?|frames?|appearance|costume|graphics?)\b/i;
/** It asks for a new thing. */
const NEW_THING = /\b(new|another|separate|extra|second|own)\s+(\w+\s+)?(object|thing|enemy|item|character|entity|copy)\b|\b(create|spawn|spawns|drops?|leaves? behind|place)\b/i;
/** It asks to take something away or change how something works. */
const TAKE_AWAY = /\b(remove|delete|take away|get rid|without|no longer|not|never|stop|stops|can't|cannot|don't|doesn't|won't|shouldn't|lose|loses|off|instead|replace|swap|change|changes|differently)\b|n't\b/i;

/** Behaviors whose removal changes how the game plays, and the words that name them in a request. */
const BEHAVIORS: Record<string, RegExp> = {
  Stompable: /stomp|jump(ed|s)? on|squash/i,
  Damage: /hurt|damage|harm|kill|deadly|dangerous/i,
  DamageReceiver: /hurt|damage|invincib|immortal|kill/i,
  Health: /health|hearts?|lives|life|die|dies|kill/i,
  Patrol: /patrol|walk|move|chase|follow/i,
  Wander: /wander|walk|move/i,
  CharacterController: /control|move|walk|jump/i,
  PhysicsBody: /physics|gravity|fall|move|solid/i,
  Collider: /collid|collision|solid|pass through|touch/i,
  Collectible: /collect|pick/i,
  Openable: /open|close|door/i,
  Switch: /switch|lever|button/i,
  Climbable: /climb|ladder/i,
  Pushable: /push/i,
  Shooter: /shoot|fire|bullet/i,
  Jumper: /jump/i,
  DoubleJump: /double|jump/i,
  LedgeGrab: /ledge|grab|hang/i,
  MovingPlatform: /mov|platform/i,
  Goal: /goal|win|finish/i,
  Timer: /timer|time/i,
};
const BEHAVIOR_WORDS = /\b(behaviou?rs?|components?|scripts?|abilit(y|ies)|works?)\b/i;

/** What the answer changed that wasn't asked for (a sentence for the AI), or null. */
export function unaskedChanges(ctx: AIContext, request: string, operations: Operation[]): string | null {
  const problems: string[] = [];
  const aboutOne = ctx.kind === 'entity' || ctx.kind === 'object';
  if (aboutOne && LOOK.test(request) && !NEW_THING.test(request) && operations.some((o) => o.op === 'create_definition')) {
    problems.push(
      'the user asked for a look of this object, not a new object: draw the picture IN this object with draw_sprite (a situation such as "defeated" for a squashed or defeated look, "hurt", "jump"…; the engine shows it at the right moment), and create no object, spawn nothing and change no script for it',
    );
  }
  // A behavior goes only when the request names it (or behavior in general) and asks for it gone or changed.
  const asked = (component: string) => TAKE_AWAY.test(request) && (BEHAVIOR_WORDS.test(request) || BEHAVIORS[component].test(request));
  {
    const removed = operations.flatMap((o) => (o.op === 'remove_component' && o.component in BEHAVIORS && !asked(o.component) ? [o.component] : []));
    if (removed.length) {
      problems.push(
        `it removes ${[...new Set(removed)].join(', ')}, which the user didn't ask for: keep every built-in behavior exactly as it is (never replace one with a script that does "the same"); change only what was asked`,
      );
    }
  }
  return problems.length ? problems.join('; and ') : null;
}
