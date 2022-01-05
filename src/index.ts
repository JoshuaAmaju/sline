import type { Interpreter } from 'xstate';
import { interpret } from 'xstate';
import {
  Context,
  Events,
  EventTypes,
  machine,
  SetType,
  States,
} from '../src/machine';

export * from './machine/types';
export { object, retry } from './tools';

import { object } from './tools';
import * as z from 'zod';

declare var __DEV__: boolean;

type HandleActions<T> = {
  set: (value: T) => void;
  setWithValidate: (value: T) => void;
};

export type Handler<T, E> = (
  | {
      error: E;
      state: 'failed';
      value?: T | null;
    }
  | {
      value: T;
      error?: E | null;
      state: 'success';
    }
  | {
      state: 'idle';
      value?: T | null;
      error?: E | null;
    }
  | {
      error?: null;
      value?: T | null;
      state: 'validating';
    }
) &
  HandleActions<T>;

type Generate<T, D, E, Es> = (ctx: Context<T, D, E, Es>) => {
  [K in keyof T]: Handler<T[K], Es>;
};

export type FormState =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'submitted'
  | 'error';

export type SubscriptionValue<T, D, E, Es> = {
  state: FormState;
  isIdle: boolean;
  isError: boolean;
  submitted: boolean;
  isSuccess: boolean;
  isValidating: boolean;
  isSubmitting: boolean;
  submittedWithError?: boolean;
  validatedWithErrors?: boolean;
  submittedWithoutError?: boolean;
} & Omit<
  Context<T, D, E, Es>,
  '__ignore' | '__validationMarker' | 'actors' | 'schema'
>;

type Service<T, D, E, Es> = {
  cancel: () => void;
  submit(...ignore: (keyof T)[]): void;
  set: <T extends SetType<T, D, E, Es>, P extends T['name']>(
    name: P,
    value: Extract<T, { name: P }>['value']
  ) => void;
  validate: (name: keyof T) => void;
  setField: <K extends keyof T>(name: K, value: T[K]) => void;
  setFieldWithValidate: <K extends keyof T>(name: K, value: T[K]) => void;
  subscribe: (
    fn: (
      val: SubscriptionValue<T, D, E, Es>,
      handlers: { [K in keyof T]: Handler<T[K], Es> }
    ) => void
  ) => () => void;
  __generate: Generate<T, D, E, Es>;
  __service: Interpreter<
    Context<T, D, E, Es>,
    any,
    Events<T, D, E, Es>,
    States<T, D, E>
  >;
};

export type Config<T, D = any, E = Error, Es = Error> = {
  onSubmit: (value: T) => D | Promise<D>;
  schema?: Context<T, D, E, Es>['schema'];
  initialValues?: { [K in keyof T]?: T[K] };
};

export const createForm = <T, D = any, E = Error, Es = Error, TData = D>({
  schema,
  onSubmit,
  initialValues,
}: Config<T, D, E, Es>): Service<T, TData, E, Es> => {
  const def = machine<T, TData, E, Es>();

  const service = interpret(
    def
      .withContext({
        ...def.context,
        schema,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        values: initialValues ?? {},
      })
      .withConfig({
        services: {
          submit: async ({ values }) => {
            const res = onSubmit(values as T);
            return res instanceof Promise ? await res : res;
          },
        },
      })
  ).start();

  const generate: Generate<T, TData, E, Es> = ({
    states,
    schema,
    values,
    errors,
  }: Context<T, TData, E, Es>) => {
    if (!schema || typeof schema === 'boolean') {
      if (__DEV__) {
        console.warn('Cannot generate handlers without schema defined');
      }

      return;
    }

    const entries = Object.keys(schema).map((id) => {
      const _id = id as keyof T;
      const state = states[_id] as any;
      const value = values[_id];
      const error = errors.get(_id);

      const handler: Handler<T[typeof _id], Es> = {
        state,
        value,
        error,
        set: (value) => {
          service.send({ id, value, type: EventTypes.Change });
        },
        setWithValidate: (value) => {
          service.send({
            id,
            value,
            type: EventTypes.ChangeWithValidate,
          });
        },
      };

      return [id, handler];
    });

    return Object.fromEntries(entries);
  };

  return {
    __service: service,
    __generate: generate,
    cancel: () => {
      service.send(EventTypes.Cancel);
    },
    validate: (name) => {
      service.send({ id: name, type: EventTypes.Validate });
    },
    set: (name, value) => {
      service.send({ type: EventTypes.Set, name, value: value as any });
    },
    setField: (name, value) => {
      service.send({ type: EventTypes.Change, id: name as string, value });
    },
    setFieldWithValidate: (name, value) => {
      service.send({
        id: name as string,
        value,
        type: EventTypes.ChangeWithValidate,
      });
    },
    submit: (...ignore) => {
      service.send({ ignore, type: EventTypes.Submit });
    },
    subscribe: (fn) => {
      const subscription = service.subscribe((_state) => {
        const { __ignore, __validationMarker, actors, schema, ...rest } =
          _state.context;

        const handlers = generate(_state.context);

        const isError = _state.matches('error');
        const submitted = _state.matches('submitted');
        const isSubmitting = _state.matches('submitting');
        const isValidating = _state.matches('validating');
        const isIdle = _state.matches('idle') || _state.matches('waitingInit');

        const submittedWithoutError = submitted && !rest.error;
        const submittedWithError = isError && !!rest.error;
        const validatedWithErrors =
          isIdle &&
          _state.history?.matches('validating') &&
          rest.errors.size > 0;

        const state: FormState = _state.matches('waitingInit')
          ? 'idle'
          : (_state.value as any);

        fn(
          {
            ...rest,

            // form states
            state,
            isIdle,
            isError,
            submitted,
            isValidating,
            isSubmitting,
            submittedWithError,
            validatedWithErrors,
            isSuccess: submitted,
            submittedWithoutError,
          },
          handlers
        );
      });

      return () => {
        subscription.unsubscribe();
      };
    },
  };
};

const schema = object({
  name: (v: string) => z.string().parse(v),
});

const form = createForm({
  schema,
  onSubmit: async () => 1,
});

form.subscribe(({ data, values }) => {});
