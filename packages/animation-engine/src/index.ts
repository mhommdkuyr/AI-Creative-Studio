import {
  BaseEngine,
  EngineConfigSchema,
  EventEmitter,
  EasingType,
  InterpolationType,
} from '@ai-creative-studio/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const AnimationEngineConfigSchema = EngineConfigSchema.extend({
  defaultEasing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional().default('ease-in-out'),
  defaultDuration: z.number().optional().default(0.5),
});

type AnimationEngineConfig = z.infer<typeof AnimationEngineConfigSchema>;

export interface IAnimation {
  id: string;
  name: string;
  type: AnimationType;
  startTime: number;
  duration: number;
  delay: number;
  easing: EasingType;
  iterations: number;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fillMode: 'none' | 'forwards' | 'backwards' | 'both';
  keyframes: IAnimationKeyframe[];
  targetId: string;
  property: string;
  enabled: boolean;
}

export type AnimationType =
  | 'transform'
  | 'opacity'
  | 'color'
  | 'filter'
  | 'width'
  | 'height'
  | 'position'
  | 'scale'
  | 'rotation'
  | 'custom';

export interface IAnimationKeyframe {
  id: string;
  offset: number;
  properties: Record<string, AnimationValue>;
  easing: EasingType;
  easingFunction?: (t: number) => number;
}

export type AnimationValue = number | string | { [key: string]: number };

export interface ITweenOptions {
  duration?: number;
  delay?: number;
  easing?: EasingType;
  iterations?: number;
  direction?: IAnimation['direction'];
  fillMode?: IAnimation['fillMode'];
}

export interface IAnimationEvaluation {
  time: number;
  progress: number;
  animationId: string;
  targetId: string;
  properties: Record<string, AnimationValue>;
}

export interface IAnimationEvents {
  'animation:created': { animation: IAnimation };
  'animation:removed': { animationId: string };
  'animation:started': { animationId: string };
  'animation:completed': { animationId: string };
  'animation:iteration': { animationId: string; iteration: number };
  'animation:cancelled': { animationId: string };
  'animation:keyframe:added': { animationId: string; keyframe: IAnimationKeyframe };
  'animation:keyframe:removed': { animationId: string; keyframeId: string };
}

export type EasingFunction = (t: number) => number;

export const EasingFunctions: Record<EasingType, EasingFunction> = {
  'linear': (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  'bounce': (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  'elastic': (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 :
      Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  'back': (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  'cubic-bezier': (t) => t,
};

export class AnimationEngine extends BaseEngine {
  private animations: Map<string, IAnimation> = new Map();
  private activeAnimations: Set<string> = new Set();
  private emitter = new EventEmitter<IAnimationEvents>();
  private defaultEasing: EasingType;
  private defaultDuration: number;
  private animationCallbacks: Map<string, (evaluation: IAnimationEvaluation) => void> = new Map();

  constructor(config: AnimationEngineConfig) {
    super(AnimationEngineConfigSchema.parse(config));
    this.defaultEasing = config.defaultEasing!;
    this.defaultDuration = config.defaultDuration!;
  }

  protected async onInitialize(): Promise<void> {
  }

  protected override async onDestroy(): Promise<void> {
    this.animations.clear();
    this.activeAnimations.clear();
    this.animationCallbacks.clear();
  }

  createAnimation(
    type: AnimationType,
    targetId: string,
    property: string,
    options?: {
      name?: string;
      startTime?: number;
      duration?: number;
      delay?: number;
      easing?: EasingType;
      iterations?: number;
      direction?: IAnimation['direction'];
      fillMode?: IAnimation['fillMode'];
    }
  ): IAnimation {
    const animation: IAnimation = {
      id: uuidv4(),
      name: options?.name || `${type}-${property}`,
      type,
      startTime: options?.startTime ?? 0,
      duration: options?.duration ?? this.defaultDuration,
      delay: options?.delay ?? 0,
      easing: options?.easing ?? this.defaultEasing,
      iterations: options?.iterations ?? 1,
      direction: options?.direction ?? 'normal',
      fillMode: options?.fillMode ?? 'none',
      keyframes: [],
      targetId,
      property,
      enabled: true,
    };

    this.animations.set(animation.id, animation);
    this.emitter.emit('animation:created', { animation });

    return animation;
  }

  removeAnimation(animationId: string): void {
    const animation = this.animations.get(animationId);
    if (!animation) return;

    this.stopAnimation(animationId);
    this.animations.delete(animationId);
    this.emitter.emit('animation:removed', { animationId });
  }

  getAnimation(animationId: string): IAnimation | undefined {
    return this.animations.get(animationId);
  }

  getAnimationsByTarget(targetId: string): IAnimation[] {
    const result: IAnimation[] = [];
    this.animations.forEach(animation => {
      if (animation.targetId === targetId) {
        result.push(animation);
      }
    });
    return result;
  }

  getAnimationsByProperty(targetId: string, property: string): IAnimation[] {
    const result: IAnimation[] = [];
    this.animations.forEach(animation => {
      if (animation.targetId === targetId && animation.property === property) {
        result.push(animation);
      }
    });
    return result;
  }

  addKeyframe(
    animationId: string,
    offset: number,
    properties: Record<string, AnimationValue>,
    easing?: EasingType
  ): IAnimationKeyframe | null {
    const animation = this.animations.get(animationId);
    if (!animation) return null;

    const keyframe: IAnimationKeyframe = {
      id: uuidv4(),
      offset: Math.max(0, Math.min(1, offset)),
      properties,
      easing: easing ?? animation.easing,
    };

    const insertIndex = animation.keyframes.findIndex(kf => kf.offset > keyframe.offset);
    if (insertIndex === -1) {
      animation.keyframes.push(keyframe);
    } else {
      animation.keyframes.splice(insertIndex, 0, keyframe);
    }

    this.emitter.emit('animation:keyframe:added', { animationId, keyframe });
    return keyframe;
  }

  removeKeyframe(animationId: string, keyframeId: string): void {
    const animation = this.animations.get(animationId);
    if (!animation) return;

    const index = animation.keyframes.findIndex(kf => kf.id === keyframeId);
    if (index === -1) return;

    animation.keyframes.splice(index, 1);
    this.emitter.emit('animation:keyframe:removed', { animationId, keyframeId });
  }

  updateKeyframe(
    animationId: string,
    keyframeId: string,
    updates: Partial<IAnimationKeyframe>
  ): void {
    const animation = this.animations.get(animationId);
    if (!animation) return;

    const keyframe = animation.keyframes.find(kf => kf.id === keyframeId);
    if (!keyframe) return;

    Object.assign(keyframe, updates);
  }

  startAnimation(animationId: string): void {
    const animation = this.animations.get(animationId);
    if (!animation || !animation.enabled) return;

    this.activeAnimations.add(animationId);
    this.emitter.emit('animation:started', { animationId });
  }

  stopAnimation(animationId: string): void {
    if (!this.activeAnimations.has(animationId)) return;

    this.activeAnimations.delete(animationId);
    this.emitter.emit('animation:completed', { animationId });
  }

  cancelAnimation(animationId: string): void {
    this.activeAnimations.delete(animationId);
    this.emitter.emit('animation:cancelled', { animationId });
  }

  evaluate(animationId: string, time: number): IAnimationEvaluation | null {
    const animation = this.animations.get(animationId);
    if (!animation || !animation.enabled) return null;

    const adjustedTime = time - animation.startTime - animation.delay;
    if (adjustedTime < 0 && animation.fillMode !== 'backwards' && animation.fillMode !== 'both') {
      return null;
    }

    let progress = adjustedTime / animation.duration;
    let currentIteration = 0;

    if (progress >= 1 && animation.iterations !== Infinity) {
      if (progress >= animation.iterations) {
        progress = 1;
      } else {
        currentIteration = Math.floor(progress);
        progress = progress % 1;
      }
    }

    if (animation.direction === 'reverse') {
      progress = 1 - progress;
    } else if (animation.direction === 'alternate') {
      progress = currentIteration % 2 === 0 ? progress : 1 - progress;
    } else if (animation.direction === 'alternate-reverse') {
      progress = currentIteration % 2 === 1 ? progress : 1 - progress;
    }

    progress = Math.max(0, Math.min(1, progress));

    const properties = this.interpolateKeyframes(animation, progress);

    return {
      time,
      progress,
      animationId: animation.id,
      targetId: animation.targetId,
      properties,
    };
  }

  private interpolateKeyframes(
    animation: IAnimation,
    progress: number
  ): Record<string, AnimationValue> {
    const keyframes = animation.keyframes;
    if (keyframes.length === 0) return {};

    if (keyframes.length === 1) {
      return keyframes[0].properties;
    }

    let startKf = keyframes[0];
    let endKf = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (progress >= keyframes[i].offset && progress <= keyframes[i + 1].offset) {
        startKf = keyframes[i];
        endKf = keyframes[i + 1];
        break;
      }
    }

    const localProgress = (progress - startKf.offset) / (endKf.offset - startKf.offset);
    const easingFn = EasingFunctions[startKf.easing];
    const easedProgress = easingFn(localProgress);

    const result: Record<string, AnimationValue> = {};

    for (const [key, value] of Object.entries(endKf.properties)) {
      const startValue = startKf.properties[key];

      if (startValue === undefined) {
        result[key] = value;
        continue;
      }

      if (typeof value === 'number' && typeof startValue === 'number') {
        result[key] = startValue + (value - startValue) * easedProgress;
      } else if (typeof value === 'string' && typeof startValue === 'string') {
        result[key] = easedProgress < 0.5 ? startValue : value;
      } else if (typeof value === 'object' && typeof startValue === 'object') {
        result[key] = this.interpolateObjects(
          startValue as Record<string, number>,
          value as Record<string, number>,
          easedProgress
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private interpolateObjects(
    start: Record<string, number>,
    end: Record<string, number>,
    t: number
  ): Record<string, number> {
    const result: Record<string, number> = {};

    for (const [key, endValue] of Object.entries(end)) {
      const startValue = start[key] ?? endValue;
      result[key] = startValue + (endValue - startValue) * t;
    }

    return result;
  }

  update(time: number): Map<string, IAnimationEvaluation> {
    const results = new Map<string, IAnimationEvaluation>();

    this.activeAnimations.forEach(animationId => {
      const evaluation = this.evaluate(animationId, time);
      if (evaluation) {
        results.set(animationId, evaluation);

        const animation = this.animations.get(animationId);
        const adjustedTime = time - animation!.startTime - animation!.delay;
        if (adjustedTime >= animation!.duration * animation!.iterations) {
          this.stopAnimation(animationId);
        }
      }
    });

    return results;
  }

  tween(
    targetId: string,
    from: Record<string, AnimationValue>,
    to: Record<string, AnimationValue>,
    options?: ITweenOptions
  ): IAnimation {
    const animation = this.createAnimation(
      'custom',
      targetId,
      'custom',
      {
        name: `tween-${targetId}`,
        duration: options?.duration,
        easing: options?.easing,
        delay: options?.delay,
        iterations: options?.iterations,
        direction: options?.direction,
        fillMode: options?.fillMode,
      }
    );

    this.addKeyframe(animation.id, 0, from);
    this.addKeyframe(animation.id, 1, to);

    return animation;
  }

  fade(
    targetId: string,
    fromOpacity: number,
    toOpacity: number,
    options?: ITweenOptions
  ): IAnimation {
    return this.tween(targetId, { opacity: fromOpacity }, { opacity: toOpacity }, options);
  }

  move(
    targetId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options?: ITweenOptions
  ): IAnimation {
    return this.tween(targetId, { x: from.x, y: from.y }, { x: to.x, y: to.y }, options);
  }

  scale(
    targetId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options?: ITweenOptions
  ): IAnimation {
    return this.tween(targetId, { scaleX: from.x, scaleY: from.y }, { scaleX: to.x, scaleY: to.y }, options);
  }

  rotate(
    targetId: string,
    from: number,
    to: number,
    options?: ITweenOptions
  ): IAnimation {
    return this.tween(targetId, { rotation: from }, { rotation: to }, options);
  }

  on<E extends keyof IAnimationEvents>(
    event: E,
    listener: (data: IAnimationEvents[E]) => void
  ): this {
    this.emitter.on(event, listener as any);
    return this;
  }

  off<E extends keyof IAnimationEvents>(
    event: E,
    listener: (data: IAnimationEvents[E]) => void
  ): this {
    this.emitter.off(event, listener as any);
    return this;
  }

  getCapabilities(): string[] {
    return [
      'animation:create',
      'animation:remove',
      'animation:start',
      'animation:stop',
      'animation:cancel',
      'animation:keyframes',
      'animation:easing',
      'animation:interpolation',
      'animation:tweens',
      'animation:transforms',
      'animation:opacity',
      'animation:color',
      'animation:filters',
    ];
  }
}

export * from './studio.js';
