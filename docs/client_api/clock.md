# Server Clock

Approximates server clock by sampling server time and network latency.
All time measurements are in seconds with sub millisecond precision.

## Properties

### `skew`

**Type**: `number`

Clock skew estimate (in seconds) relative to server clock (`server clock == local clock + skew`).

### `last_skew`

**Type**: `number`

Latest skew estimate in seconds.

### `rtt`

**Type**: `number`

Estimated round trip time (RTT) in seconds.

### `last_rtt`

**Type**: `number`

Latest round trip time (RTT) measurment in seconds.

### `skew_std`

**Type**: `number`

Standard deviation of clock skew across current samples in seconds.

### `rtt_std`

**Type**: `number`

Standard deviation of round trip time (RTT) across current samples in seconds.

### `skew_range`

**Type**: `number`

Clock skew range (max - min) across current samples in seconds.

### `rtt_range`

**Type**: `number`

Round trip time (RTT) range (max - min) across current samples in seconds.

## Methods

### `now()`

Returns current estimated server time in seconds (after epoch).

**Returns**: `number` - Current estimated server timestamp in seconds

