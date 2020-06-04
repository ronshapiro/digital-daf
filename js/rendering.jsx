import {onceDocumentReady} from "./once_document_ready.js";
import {Component, render, h, div, createContext, createRef} from "preact";
import {useState, useContext} from 'preact/hooks';

// TODO(react): add keys wherever seems necesary

jQuery.fn.extend({
  betterDoubleClick: function(fn) {
    if (!!navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform)) {
      this.click(function(event) {
        let lastTime = this.lastTime || 0;
        const now = new Date().getTime();
        if (now - lastTime <= 1000) {
          fn(event);
          this.lastTime = 0;
        } else {
          this.lastTime = now;
        }
      });
    } else {
      this.dblclick(fn);
    }
    return this;
  }
});
const applyDoubleClick = (element, fn) => {
  // TODO(react): remove jQuery
  $(element).betterDoubleClick(fn);
};

const ConfigurationContext = createContext();
const useTranslationOption = () => useContext(ConfigurationContext).translationOption;
const useCommentaryTypes = () => useContext(ConfigurationContext).commentaryTypes;

const debugResultsData = {}

const _concat = function() {
  const result = [];
  for (const arg of arguments) {
    if (arg) result.push(...arg);
  }
  return result;
}

const isEmptyText = (stringOrList)  => {
  return !stringOrList || stringOrList === "" || stringOrList.length == 0;
}

const stringOrListToString = (stringOrList) => {
  return typeof stringOrList === "string"
    ? stringOrList
    : stringOrList.join("<br>");
}

class Cell extends Component {
  defaultClasses = [];

  classes() {
    return _concat(this.props.classes, ["table-cell"], this.defaultClasses).join(" ");
  }

  // TODO: props.text is an awkward name.
  applyChildrenUnsafely(element) {
    if (typeof this.props.text === "string") {
      element.props.dangerouslySetInnerHTML = {__html: this.props.text};
    } else {
      element.props.children = this.props.text;
    }
    return element;
  }
}

class HebrewCell extends Cell {
  defaultClasses = ["hebrew"];
  ref = createRef();

  render() {
    return this.applyChildrenUnsafely(
      <div dir="rtl" class={this.classes()} ref={this.ref} />
    );
  }

  componentDidMount() {
    applyDoubleClick(this.ref.current, this.props.hebrewDoubleClickListener);
    this.forceUpdate(); // to trigger componentDidUpdate();
  }

  componentDidUpdate() {
    if (this.called) {
      return;
    }
    this.called = true;
    const maxLines = Math.floor(
      $(this.ref.current).height() / $(this.props.englishRef.current).height());
    if (maxLines > 1) { // Also checks that maxLines is not NaN
      this.props.updateHebrewLineCount(maxLines.toString());
    }
  }
}

class EnglishCell extends Cell {
  defaultClasses = ["english"];
  state = {
    lineClamped: true,
  };

  render() {
    // TODO: attempt to remove english-div
    const innerClasses = ["english-div"];
    if (this.state.lineClamped) {
      innerClasses.push("line-clampable");
    }
    return (
      <div dir="ltr" class={this.classes()} ref={this.props.englishRef}>
        {this.applyChildrenUnsafely(
          <div class={innerClasses.join(" ")}
               style={`-webkit-line-clamp: ${this.props.lineClampLines};`} />)}
      </div>);
  }

  componentDidMount() {
    applyDoubleClick(
      this.props.englishRef.current,
      () => this.setState({lineClamped: !this.state.lineClamped}));
  }
}

class TableRow extends Component{
  state = {hebrewLineCount: 1}
  englishRef = createRef();
  
  render() {
    const classes = _concat(["table-row"], this.props.classes).join(" ");
    const {hebrew, english, hebrewDoubleClickListener} = this.props;
    
    const cells = [];
    if (!isEmptyText(hebrew)) {
      cells.push(
        <HebrewCell
          text={hebrew}
          classes={this.cellClasses()}
          updateHebrewLineCount={newCount => this.setState({hebrewLineCount: newCount})}
          hebrewDoubleClickListener={hebrewDoubleClickListener}
          englishRef={this.englishRef}
          />);
    }
    if (!isEmptyText(english)) {
      cells.push(
        <EnglishCell
          text={english}
          classes={this.cellClasses()}
          englishRef={this.englishRef}
          lineClampLines={this.state.hebrewLineCount}
          />);
    }
    
    const output = <div classes={classes}>{cells}</div>;
    output.props["sefaria-ref"] = this.props["sefaria-ref"];
    return output;
  }

  cellClasses() {
    const {hebrew, english, overrideFullRow} = this.props;
    if ((isEmptyText(hebrew) || isEmptyText(english)) && !overrideFullRow) {
      return ["fullRow"];
    }
    return [];
  }
}

class CommentRow extends Component {
  renderTableRow(hebrew, english) {
    const {comment, commentaryKind} = this.props;
    return (
      <TableRow
        hebrew={hebrew}
        english={english}
        sefaria-ref={comment.ref}
        commentary-kind={commentaryKind.englishName}
        />);
  }

  render() {
    const {comment, commentaryKind} = this.props;

    const output = [];
    if (commentaryKind.showTitle) {
      output.push(
        this.renderTableRow(
          <strong>{comment.sourceHeRef}</strong>,
          isEmptyText(comment.en) ? "" : <strong>{comment.sourceRef}</strong>));
    }

    if (Array.isArray(comment.he) && Array.isArray(comment.en)
        && comment.he.length === comment.en.length) {
      for (let i = 0; i < comment.he.length; i++) {
        output.push(this.renderTableRow(comment.he[i], comment.en[i]));
      }
    } else if (isSefariaReturningLongListsOfSingleCharacters(comment)) {
      output.push(this.renderTableRow(comment.he.join(""), comment.en.join("")));
    } else {
      output.push(
        this.renderTableRow(
          stringOrListToString(comment.he),
          stringOrListToString(comment.en)));;
    }

    return output;
  }
}

// https://github.com/Sefaria/Sefaria-Project/issues/541
const isSefariaReturningLongListsOfSingleCharacters = (comment) => {
  if (!Array.isArray(comment.he) || !Array.isArray(comment.en)) {
    return false;
  }
  const reducer = (numberOfSingleCharacters, x) =>
        numberOfSingleCharacters + ((x.length === 1) ? 1 : 0);
  // 3 is a guess of a reasonable minimum for detecting that this is a bug
  return comment.he.reduce(reducer, 0) > 3 && comment.en.reduce(reducer, 0) > 3;
}

const forEachCommentary = (commentaries, action) => {
  for (const commentaryKind of useCommentaryTypes()) {
    const commentary = commentaries[commentaryKind.englishName];
    if (commentary) {
      action(commentary, commentaryKind);
    }
  }
}

class CommentarySection extends Component {
  render() {
    const {commentaries, showing, toggleShowing} = this.props;
    if (!commentaries || commentaries.length === 0) {
      return;
    }

    const output = [];
    forEachCommentary(commentaries, (commentary, commentaryKind) => {
      if (showing[commentaryKind.className]) {
        output.push(this.renderTableRow(this.renderButton(commentaryKind), ""));
        commentary.comments.forEach(comment => {
          output.push(
            <CommentRow comment={comment} commentaryKind={commentaryKind} />);
        });

        if (commentary.commentary) {
          const nestedToggleShowing =
                (...args) => toggleShowing("nested", commentaryKind.className, ...args);
          output.push(
            <CommentarySection
              commentaries={commentary.commentary}
              showing={showing.nested[commentaryKind.className]}
              toggleShowing={nestedToggleShowing}
              />);
        }
      }
    });

    output.push(this.renderShowButtons());
    return output;
  }

  renderTableRow(hebrew, english) {
    const overrideFullRow = useTranslationOption() === "english-side-by-side";
    return <TableRow hebrew={hebrew} english={english} overrideFullRow={overrideFullRow} />;
  }

  renderShowButtons() {
    const {commentaries, showing} = this.props;
    const buttons = [];
    forEachCommentary(commentaries, (commentary, commentaryKind) => {
      if (!showing[commentaryKind.className]) {
        buttons.push(this.renderButton(commentaryKind));
      }
    });
    return this.renderTableRow(buttons, "");
  }

  renderButton(commentaryKind) {
    const {toggleShowing} = this.props;

    if (localStorage.showTranslationButton !== "yes"
        && commentaryKind.className === "translation") {
      return;
    }

    const classes = [
      "commentary_header",
      commentaryKind.className,
      commentaryKind.cssCategory,
    ].join(" ");
    const onClick = () => {
      // DO NOT SUBMIT gtag
      toggleShowing(commentaryKind.className);
    };
    const onKeyUp = event => {
      if (event && event.code === "Enter") {
        onClick();
        // DO NOT SUBMIT: maintain focus on the same button after rerendering
      }
    }
    return (
      <a class={classes} tabindex="0" onclick={onClick} onkeyup={onKeyUp}>
        {commentaryKind.hebrewName}
      </a>);
  }
}

const initShowingState = (commentaries, showing) => {
  showing.ordering = [];
  forEachCommentary(commentaries, (commentary, commentaryKind) => {
    showing[commentaryKind.className] = false;
    if (commentary.commentary) {
      if (!showing.nested) {
        showing.nested = {};
      }
      showing.nested[commentaryKind.className] = {};
      initShowingState(commentary.commentary, showing.nested[commentaryKind.className]);
    }
  });
};

class Section extends Component {
  constructor(props) {
    super(props);
      // DO NOT SUBMIT: Add a showing.order state property so that Tosafot can appear before Rashi
    this.state = {showing: {}};
    initShowingState(props.section.commentary, this.state.showing);
  }

  render() {
    const {section, sectionLabel} = this.props;
    const sectionContents = [];
    const toggleShowing = (...commentaryNames) => {
      // TODO: reducer?
      const newState = {...this.state};
      let nestedState = newState.showing;
      for (const commentaryName of commentaryNames.slice(0, -1)) {
        if (!(commentaryName in nestedState)) {
          nestedState[commentaryName] = {};
        }
        nestedState = nestedState[commentaryName];
      }
      const propertyName = commentaryNames.slice(-1);
      nestedState[propertyName] = !nestedState[propertyName];
      this.setState(newState);
    };
    sectionContents.push(
      // TODO: can this id be removed with a `#${sectionLabel} .gemara` selector?
      <TableRow
        hebrew={`<div class="gemara" id="${sectionLabel}-gemara">${section.he}</div>`}
        hebrewDoubleClickListener={() => toggleShowing("translation")}
        english={useTranslationOption() === "english-side-by-side" ? section.en : undefined}
        classes={["gemara-container"]} />);

    if (section.commentary) {
      sectionContents.push(
        <CommentarySection
          commentaries={section.commentary}
          showing={this.state.showing}
          toggleShowing={toggleShowing} />);
    }

    return (
      <div id={sectionLabel} class="section-container" sefaria-ref={section["ref"]}>
        {sectionContents}
      </div>
    );
  }
}

class Amud extends Component {
  render() {
    const {containerData} = this.props;
    const output = [<h2>{containerData.title}</h2>];
    if (containerData.loading) {
      output.push(
        <div key={`${containerData.id}-loading-spinner`}
             class="text-loading-spinner mdl-spinner mdl-spinner--single-color mdl-js-spinner is-active" />);
    }
    for (let i = 0; i < containerData.sections.length; i++) {
      const section = containerData.sections[i];
      if (i !== 0 && section.steinsaltz_start_of_sugya) {
        output.push(<br class="sugya-separator" />);
      }

      const sectionLabel = `${containerData.id}_section_${i+1}`;
      output.push(<Section section={section} sectionLabel={sectionLabel} />);
    }
    return output;
  }
}

class Renderer {
  constructor(commentaryTypes, translationOption) {
    this._commentaryTypes = commentaryTypes;
    this._translationOption = translationOption;
  }

  _applyClientSideDataTransformations(containerData) {
    if (!containerData.sections) {
      containerData.sections = [];
    }
    for (const section of containerData.sections) {
      const commentaries = section.commentary;

      if (commentaries) {
        if (this._translationOption === "both") {
          commentaries.Translation = commentaries.Steinsaltz;
          if (commentaries.Translation) {
            // e.g. Hadran sections have no steinsaltz
            commentaries.Translation.comments[0].en = section.en;
          }
          delete commentaries.Steinsaltz;
        }
      }
    }
  }

  // containerData is an awkward name, but "section" was already taken. Perhaps that can be changed
  // and then we can switch this over?
  renderContainer(containerData, divId) {
    debugResultsData[containerData.id] = containerData;
    this._applyClientSideDataTransformations(containerData);

    const context = {
      translationOption: this._translationOption,
      commentaryTypes: this._commentaryTypes,
    };
    render(
      <ConfigurationContext.Provider value={context}>
          <Amud containerData={containerData} />
      </ConfigurationContext.Provider>,
      document.getElementById(divId));

    // Make sure mdl always registers new views correctly
    componentHandler.upgradeAllRegistered();
  };
}

class TalmudRenderer extends Renderer {
  constructor(translationOption) {
    super(TalmudRenderer._defaultCommentaryTypes(), translationOption);
  }

  static _defaultCommentaryTypes() {
    const commentaryTypes = [
      {
        englishName: "Translation",
        hebrewName: "Translation",
        className: "translation",
      },
      {
        englishName: "Verses",
        hebrewName: 'תנ״ך',
        className: "psukim",
        showTitle: true,
      },
      {
        englishName: "Mishnah",
        hebrewName: "משנה",
        className: "mishna",
        showTitle: true,
      },
      {
        englishName: "Tosefta",
        hebrewName: "תוספתא",
        className: "tosefta",
        showTitle: true,
      },
      {
        englishName: "Rashi",
        hebrewName: 'רש"י',
        className: "rashi",
      },
      {
        englishName: "Tosafot",
        hebrewName: "תוספות",
        className: "tosafot"
      },
      {
        englishName: "Rabbeinu Chananel",
        hebrewName: 'ר"ח',
        className: "rabbeinu-chananel",
      },
      {
        englishName: "Ramban",
        hebrewName: 'רמב״ן',
        className: "ramban"
      },
      {
        englishName: "Rashba",
        hebrewName: 'רשב״א',
        className: "rashba"
      },
      {
        englishName: "Maharsha",
        hebrewName: 'מהרש"א',
        className: "maharsha",
      },
      {
        englishName: "Maharshal",
        hebrewName: 'מהרש"ל',
        className: "maharshal",
      },
      {
        englishName: "Meir Lublin",
        hebrewName: 'מהר"ם לובלין',
        className: "meir-lublin",
      },
      {
        englishName: "Rosh",
        hebrewName: 'רא"ש',
        className: "rosh",
      },
      {
        englishName: "Ritva",
        hebrewName: 'ריטב"א',
        className: "ritva",
      },
      {
        englishName: "Rav Nissim Gaon",
        hebrewName: "רבנו נסים",
        className: "rav-nissim-gaon",
      },
      {
        englishName: "Shulchan Arukh",
        hebrewName: "שולחן ערוך",
        className: "shulchan-arukh",
        cssCategory: "ein-mishpat",
        showTitle: true,
      },
      {
        englishName: "Mishneh Torah",
        hebrewName: "משנה תורה",
        className: "mishneh-torah",
        cssCategory: "ein-mishpat",
        showTitle: true,
      },
      {
        englishName: "Mesorat Hashas",
        type: "mesorat hashas",
        hebrewName: 'מסורת הש״ס',
        className: "mesorat-hashas",
        showTitle: true,
      },
      {
        englishName: "Jastrow",
        hebrewName: "Jastrow",
        className: "jastrow",
      },
    ];

    const steinsaltz = {
      englishName: "Steinsaltz",
      hebrewName: "שטיינזלץ",
      className: "translation",
    };

    if (localStorage.showTranslationButton === "yes") {
      commentaryTypes.push(steinsaltz);
    } else {
      commentaryTypes.unshift(steinsaltz);
    }

    return commentaryTypes;
  }
}

module.exports = {
  _concat: _concat,
  Renderer: Renderer,
  TalmudRenderer: TalmudRenderer,
};
