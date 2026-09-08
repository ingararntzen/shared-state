# Server Clock

The `client.clock` instance (`ServerClock`) estimates high-precision server time, clock skew, and transit latency.

## Properties

### `pinger`

**Type**: `Object`

Underlying Pinger instance.

### `skew`

**Type**: `number`

Estimated clock skew relative to server in seconds.

### `trans`

**Type**: `number`

Estimated minimum transit delay in seconds.

### `latest_trans`

**Type**: `number`

Latest raw ping transit delay in seconds.

### `latest_skew`

**Type**: `number`

Latest raw ping clock skew in seconds.

### `rtt`

**Type**: `number`

Estimated round trip time (RTT) in seconds.

### `trans_std`

**Type**: `number`

Standard deviation of transit delay across current samples in seconds.

### `skew_std`

**Type**: `number`

Standard deviation of clock skew across current samples in seconds.

### `trans_range`

**Type**: `number`

Transit delay range (max - min) across current samples in seconds.

### `skew_range`

**Type**: `number`

Clock skew range (max - min) across current samples in seconds.

## Methods

### `restart()`

Restarts clock synchronization sampling.

**Returns**: `void`

### `now()`

Returns current estimated server time in epoch seconds (high precision).

**Returns**: `number` - Current estimated server timestamp in seconds

