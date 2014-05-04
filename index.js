"use strict";
function noop(){}
function True(){return true}

function ident(x) {return x}

// specialize type checks per property type to use fast property lookup
function specializedCheck (key, typ) {
	if (typ === Primitive) {
		return "(typeof val === 'string' || typeof val === 'number')"
	}
	if (typ === Any) {
		return '(true)'
	}
	if (typ === String) {
		return '(typeof val === "string")'
	}
	if (typ === Number) {
		return '(typeof val === "number")'
	}
	var typ = 'this.__types['+key+']';
	return '('+typ+'.hasInstance ? '+typ+'.hasInstance(val) : val instanceof '+typ+')'
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
function specializedConstructor (names, debug) {
	var str = ''
	if (debug) {
		str += names.map(function(name, i){
			return 'Object.defineProperty(this, "_'+name+'", {enumerable: false, value: '+name+', writable: true})'
		}).join('\n') + '\n'
		str += names.map(function(name, i){
			return 'Object.defineProperty(this, "'+name+'", Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), "'+name+'"))'
		}).join('\n') + '\n'
	} else {
		str += names.map(function(name, i){
			return 'this.'+name+' = '+name
		}).join('\n');
	}
	return str
}

// creates an array from a object
function specializedUnapply (names) {
	return new Function('x',
		'return ['+names.map(function(name){return 'x.'+name}).join(',')+']'
	)
}

var prototype = Object.create(null, {value:{_type: 'Type'}});
var Any = {};
var Types = {};
var Primitive = {}
function Type (name, desc, parent, debug) {
	var names, typs;
	// stuff in here can be slow, it's only run once
	if (desc instanceof Array) {
		names = desc.map(function(val, i){return i.toString()});
	} else {
		names = Object.keys(desc);
	}

	var constructor = Function.apply(null, names.concat([
			specializedConstructor(names, debug)
			+ (debug ? ';Object.seal(this);' : '')
			+ ';return this;'
		]))
	
	constructor.__typeName = name;

	Types[name] = constructor;

	typs = names.map(function(name){
		return desc[name]
	});

	// one shot deferred type resolution
	typs.forEach(function(typ, i){
		if (typeof typ === 'string') {
			Object.defineProperty(typs, i, {
				get: function(){
					var val = Types[names[i]];
					this[i] = val;
					return val;
				}
			})
		}
	})

	// all instances inherit from Type
	var proto = Object.create(
			(typeof parent !== 'undefined' ? parent.prototype : prototype), {
		toJSON: {value: specializedToJSON(name, names)},
		__types: (debug ? {value: typs} : {value: undefined})
	})

	var name;
	// create the getters/setters, these need to be fast, they
	// are executed on every property lookup
	if (debug) {
		for (var i = 0; i < names.length; i++) {
			name = names[i];
			Object.defineProperty(proto, name, {
				enumerable: true,
				get: new Function('return this._'+name),
				set: new Function('val',
					(debug ?
					 'if (!'+specializedCheck(i, typs[i])+') throw new TypeError();' : '')
					+ 'this._'+name+' = val;'
				)
			})
		} 
	}

	constructor.prototype = proto;

	// methods for the pattern matcher

	constructor.unapplyObject = ident;
	constructor.unapply = specializedUnapply(names);

	return constructor
}

Type.prototype = prototype;
	
module.exports = Type
