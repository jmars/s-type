var _ = require('lazy.js');

/* S-Type
 * ------
 * Yes, this code is really ugly, and the use of eval/Function is
 * "considered harmful". But that is just a guideline.
 *
 * So what this does is use code generation at runtime to compile
 * a specialized version of Type for each definition. Why? Because
 * property lookups like foo.bar are known at compile time and the
 * JIT can optimize/inline them, while lookups like foo[bar] are not
 * known until they are run. That is the main optimization.
 *
 * The functions are also created using Function() so that they don't
 * have an enclosing context. Because the JIT inliner cannot inline
 * methods who have variables in their context that are not available
 * in the callers context, aside from the arguments and 'this'. This
 * also means the getters/setters that do typechecking are inlined
 * into hot-loops, making them almost free.
 *
 * The other optimization is that all of the properties are declared
 * in the generated constructor, so that all instances of a definition
 * have the same shadow-class. Basically it means that the VM can treat
 * them all as the same 'type'. So it knows the property offsets and
 * can treat them like structs instead of hash-maps.
 *
 * Profiling shows that indeed, a loop creating instances and then
 * changing properties on them is correctly optimized. At 100000 iterations
 * all setters and getters are inlined, the constructor is inlined, so are
 * type checks. The property changes/reads inside the setter/getters
 * are also compiled into offsets.
 *
 * That leaves the allocations themselves as the main bottleneck,
 * since we know the property types it should be possible to
 * implement object pooling. I plan to do this but the current
 * level of performance is sufficient for what I need this for,
 * at least for now.
 *
 * Each instance also has a changes property, which is a Lazy.js
 * sequence that can be mapped/filtered for observing and filtering
 * property changes lazily. The overhead of this is about 1ms per 10000
 * property changes or about 10x slower, I consider this acceptable.
 * Profiling shows that the entire code path for change notifications
 * is also optimized.
 *
 * Typechecking and the changes feed can be disabled, removing their
 * overhead altogether. Disabling both makes property sets blazing
 * fast: up to 10,000,000 sets in 0.070s. Getters/Setters can also be
 * disabled for those poor souls stuck supporting crappy VM's. If so,
 * Instance.set_foo(val) methods will be created on the prototype to
 * allow typechecking and/or change notification to still take place.
 *
 * Don't turn off getters/setters for 'performance'! Actual profiling shows
 * that in optimized code paths there is ZERO difference in performance.
 * 
 * */

function noop(){};

var Sequence = _.createWrapper(noop);

function ident(x) { return x }

// specialize type checks per property type to use fast property lookup
function specializedCheck (key, typ) {
	if (typ === String) {
		return new Function('val', 'return typeof val === "string"')
	}
	if (typ === Number) {
		return new Function('val', 'return typeof val === "number"')
	}
	return new Function('val', 'var typ = this.__types['+key+'];'
	+ 'return (typ.hasInstance ? typ.hasInstance(val) : val instanceof typ)')
}

// again, specialize per type to reduce slow property lookups
function specializedToJSON (name, names) {
	return new Function(
		'return {_type: "'+name+'",'
	+ names.map(function(name){return name+': this._'+name}).join(',')
	+ '}'
	)
}

// specialize property setup
function specializedConstructor (names) {
	return names.map(function(name, i){
		return 'this.'+name+' = '+name
	}).join('\n')
}

// creates an array from a object
function specializedUnapply (names) {
	return new Function('x',
		'return ['+names.map(function(name){return 'x.'+name}).join(',')+']'
	)
}

// Create a type
function Type (name, desc, parent) {
	// stuff in here can be slow, it's only run once
	if (desc instanceof Array) {
		var names = desc.map(function(val, i){return i.toString()});
		var typs = desc;
	} else {
		var names = Object.keys(desc);
		var typs = names.map(function(name){return desc[name]});
	}

	var constructor = Function.apply(null, names.concat([
			  (Type.changesFeed ? 'this.changes = this.__createSequence();' : '')
			+ specializedConstructor(names)
			//+ ';Object.seal(this)' -- current v8 bug makes this cause a DEOPT/bailout
			+ ';return this'
		]))
	
	// all instances inherit from Type
	var proto = Object.create(
			(typeof parent !== 'undefined' ? parent.prototype : Type.prototype), {
		__createSequence: {value: Sequence},
		toJSON: {value: specializedToJSON(name, names)},
		__types: {value: typs},
		__typeChecks: {value: names.map(function(name, i){
			return specializedCheck(i, typs[i])
		})}
	})

	var name;
	// create the getters/setters, these need to be fast, they
	// are executed on every property lookup
	for (var i = 0; i < names.length; i++) {
		name = names[i];
		if (Type.setters) {
			Object.defineProperty(proto, name, {
				get: new Function('return this._'+name),
				set: new Function('val',
					(Type.typeCheck ?
					 'if (!this.__typeChecks['+i+'](val)) throw new TypeError();' : '')
					+ 'this._'+name+' = val;'
					+ (Type.changesFeed ? 'this.changes.emit("'+name+'")' : '')
				)
			})
		} else {
			proto['set_'+name] = new Function('val',
				(Type.typeCheck ?
				 'if (!this.__typeChecks['+i+'](val)) throw new TypeError();' : '')
				+ 'this.'+name+' = val;'
				+ (Type.changesFeed ? 'this.changes.emit("'+name+'")' : '')
			)
		}
	}

	constructor.prototype = proto;

	// methods for the pattern matcher

	constructor.unapplyObject = ident;
	constructor.unapply = specializedUnapply(names);

	return constructor
}

Type.prototype = Object.create(null, {value:{_type: 'Type'}});
Type.changesFeed = true;
Type.typeCheck = true;
Type.setters = true;

module.exports = Type
