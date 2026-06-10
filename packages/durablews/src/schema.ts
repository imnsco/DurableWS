/**
 * The Standard Schema v1 interface (https://standardschema.dev), vendored as
 * types-only per the spec's guidance — implementing libraries (zod, valibot,
 * arktype, …) conform to this shape, so DurableWS can accept any of them
 * without depending on any of them. Keeps core zero-dependency.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
    export interface Props<Input = unknown, Output = Input> {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (
            value: unknown
        ) => Result<Output> | Promise<Result<Output>>;
        readonly types?: Types<Input, Output> | undefined;
    }

    export type Result<Output> = SuccessResult<Output> | FailureResult;

    export interface SuccessResult<Output> {
        readonly value: Output;
        readonly issues?: undefined;
    }

    export interface FailureResult {
        readonly issues: ReadonlyArray<Issue>;
    }

    export interface Issue {
        readonly message: string;
        readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
    }

    export interface PathSegment {
        readonly key: PropertyKey;
    }

    export interface Types<Input = unknown, Output = Input> {
        readonly input: Input;
        readonly output: Output;
    }

    export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
        Schema["~standard"]["types"]
    >["input"];

    export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
        Schema["~standard"]["types"]
    >["output"];
}

/**
 * Thrown (as an `error` event payload) when an inbound message fails the
 * configured schema. The message is **not** emitted — handlers only ever see
 * data that passed validation.
 */
export class SchemaValidationError extends Error {
    readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;

    constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>) {
        super(
            `Inbound message failed schema validation: ${issues
                .map((issue) => issue.message)
                .join("; ")}`
        );
        this.name = "SchemaValidationError";
        this.issues = issues;
    }
}
