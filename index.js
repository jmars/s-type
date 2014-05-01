var _ = require('lazy.js');


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
