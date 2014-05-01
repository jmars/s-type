S-Type
------

## Usage
```javascript
var Type = require('s-type');

// These all default to true.
//Type.changesFeed = false;
//Type.typeCheck = false;
//Type.setters = false;

var test = Type('foo', {
	first: String,
	last: Number
})

var bar = new test('jaye', 1);
console.log(bar instanceof Type); // true
console.log(bar instanceof test); // true
console.log(bar instanceof Object); // false

var test2 = Type('bar', {
	one: Number
}, test)

var foo = new test2(10);

foo.changes.map(function(key){return key.length}).each(function(len){
	console.log(len)
})

foo.one = 100;
// '3'

console.log(foo instanceof Type); // true
console.log(foo instanceof test); // true
console.log(foo instanceof test2); // true
console.log(foo instanceof Object); //false
```

## Why?
`10,000,000 property changes`
```
[deoptimize context: 11fca74414b1]
[21601]       36 ms: Scavenge 2.3 (36.0) -> 2.1 (36.0) MB, 0 ms [allocation failure].
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[disabled optimization for , reason: eval]
[marking  0x6a0b3fadb38 for recompilation, reason: small function, ICs with typeinfo: 5/6 (83%)]
Did not inline ctor.emit called from  (target requires context change).
[optimizing:  / 6a0b3fadb39 - took 0.145, 0.156, 0.000 ms]
[marking  0x6a0b3fac2e0 for recompilation, reason: small function, ICs with typeinfo: 0/0 (100%)]
[optimizing:  / 6a0b3fac2e1 - took 0.025, 0.034, 0.000 ms]
[marking ctor.emit 0x3b933bb70048 for recompilation, reason: small function, ICs with typeinfo: 3/8 (37%)]
[optimizing: ctor.emit / 3b933bb70049 - took 0.050, 0.078, 0.000 ms]
[marking  0x6a0b3f09e40 for recompilation, reason: small function, ICs with typeinfo: 4/7 (57%)]
Did not inline require called from  (target requires context change).
Did not inline Type called from  (target text too big).
Inlined  called from .
Did not inline ctor.emit called from  (target requires context change).
Inlined  called from .
Inlined  called from .
Did not inline ctor.emit called from  (target requires context change).
Inlined  called from .
[optimizing:  / 6a0b3f09e41 - took 0.165, 0.258, 0.000 ms]
node --crankshaft --trace_inlining --trace-opt --trace-deopt --trace-gc   1.87s user 0.03s system 100% cpu 1.881 total
```

Yes, this code is really ugly, and the use of eval/Function is
"considered harmful". But that is just a guideline.

So what this does is use code generation at runtime to compile
a specialized version of Type for each definition. Why? Because
property lookups like foo.bar are known at compile time and the
JIT can optimize/inline them, while lookups like foo[bar] are not
known until they are run. That is the main optimization.

The functions are also created using Function() so that they don't
have an enclosing context. Because the JIT inliner cannot inline
methods who have variables in their context that are not available
in the callers context, aside from the arguments and 'this'. This
also means the getters/setters that do typechecking are inlined
into hot-loops, making them almost free.

The other optimization is that all of the properties are declared
in the generated constructor, so that all instances of a definition
have the same shadow-class. Basically it means that the VM can treat
them all as the same 'type'. So it knows the property offsets and
can treat them like structs instead of hash-maps.

Profiling shows that indeed, a loop creating instances and then
changing properties on them is correctly optimized. At 100000 iterations
all setters and getters are inlined, the constructor is inlined, so are
type checks. The property changes/reads inside the setter/getters
are also compiled into offsets.

That leaves the allocations themselves as the main bottleneck,
since we know the property types it should be possible to
implement object pooling. I plan to do this but the current
level of performance is sufficient for what I need this for,
at least for now.

Each instance also has a changes property, which is a Lazy.js
sequence that can be mapped/filtered for observing and filtering
property changes lazily. The overhead of this is about 1ms per 10000
property changes or about 10x slower, I consider this acceptable.
Profiling shows that the entire code path for change notifications
is also optimized.

Typechecking and the changes feed can be disabled, removing their
overhead altogether. Disabling both makes property sets blazing
fast: up to 10,000,000 sets in 0.070s. Getters/Setters can also be
disabled for those poor souls stuck supporting crappy VM's. If so,
`Instance.set_foo(val)` methods will be created on the prototype to
allow typechecking and/or change notification to still take place.

Don't turn off getters/setters for 'performance'! Actual profiling shows
that in optimized code paths there is ZERO difference in performance.
