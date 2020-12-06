import {v4 as uuid} from "uuid";
// @ts-ignore
import {promiseParts} from "./promises.ts";

class RetryState {
  delay: number
  id: string
  promise: Promise<any>
  proceed: (_t: any) => void

  constructor(delay = 200) {
    this.delay = delay;
    this.id = uuid();
    [this.promise, this.proceed] = promiseParts<any>().slice(0, 2);
  }

  increment() {
    this.delay *= 1.5;
  }
}

interface AnyFunction {
  (...params: any[]): any;
}

interface RetryingMethodOptions {
  retryingCall: (...params: any[]) => Promise<any>;
  then?: (successValue?: any) => void;
  createError?: (...params: any[]) => string;
}

interface ErrorsDelegate {
  add: (id: string, errorMessage: string) => void;
  remove: (id: string) => void;
}

interface GeneratedRetryingMethodSignature {
  (...params: any[]): Promise<any>;
}

export class RetryMethodFactory {
  errorsDelegate: ErrorsDelegate;
  onErrorStateChange: () => void;
  errorLogger: AnyFunction;

  constructor(
    errorsDelegate: ErrorsDelegate,
    onErrorStateChange: () => void,
    errorLogger: AnyFunction = console.error) {
    this.errorsDelegate = errorsDelegate;
    this.onErrorStateChange = onErrorStateChange;
    this.errorLogger = errorLogger;
  }

  /**
   * Returns a function that will call `options.retryingCall` repeatedly until it succeeds,
   * implementing a backoff policy upon failed calls.
   *
   * The returned `Promise` _never_ fails; it will succeed once the `opitons.retryingCall`
   * eventually has a successful promise.
   *
   * If a function is provided as `options.then`, the returned `Promise` will have it chained.
   *
   * If a function is provided as `options.createError`, it will be called to create an error
   * if `options.retryingCall` fails.
   */
  retryingMethod(options: RetryingMethodOptions): GeneratedRetryingMethodSignature {
    const doCall: GeneratedRetryingMethodSignature = (...args) => {
      let retryState: RetryState;
      const lastArg = args.slice(-1)[0];
      if (args.length > 0 && lastArg instanceof RetryState) {
        retryState = lastArg;
        args = args.slice(0, -1);
      } else {
        retryState = new RetryState();
        const _then = options.then; // tsc seems to get confused if `const then = {options}` is used
        if (_then) {
          retryState.promise = retryState.promise.then((thenArg) => _then(thenArg));
        }
      }

      options.retryingCall(...args)
        .then(
          (thenArg: any) => {
            this.errorsDelegate.remove(retryState.id);
            this.onErrorStateChange();
            retryState.proceed(thenArg);
          },
          (errorResponse: any) => {
            this.errorLogger(errorResponse);
            this.errorLogger(options);
            if (options.createError) {
              const userVisibleMessage = options.createError(...args);
              if (userVisibleMessage) {
                this.errorsDelegate.add(retryState.id, userVisibleMessage);
                this.onErrorStateChange();
              }
            }
            setTimeout(() => {
              retryState.increment();
              doCall(...args, retryState);
            }, retryState.delay);
          });
      return retryState.promise;
    };
    return doCall;
  }
}