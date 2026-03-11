export const RequestStatus = {
    SUCCESS: "SUCCESS",
    FAILED: "FAILED"
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];
